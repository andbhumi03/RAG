import { getGroqChatCompletion, getGroqChatCompletionStream } from '../groq.js';
import {
    executeDocumentSearch,
    executeListUserDocuments,
    executeCalculator,
    AGENT_TOOLS_CONFIG
} from './tools.js';
/**
 * Runs the Autonomous Agent Loop (ReAct: Reason -> Act -> Observe -> Repeat)
 * @param {Array} messages - Current conversation history
 * @param {String} userId - User ID for database filtering
 * @param {Function} onStep - Callback to stream intermediate agent steps to frontend (optional)
 * @param {Function} onToken - Callback to stream final answer tokens in real time (optional)
 */
function filterGroundedSources(answerText, collectedSources) {
    const sources = Array.from(collectedSources.values());
    const answer = String(answerText || '').toLowerCase().trim();
    if (!answer || /do not contain this information/i.test(answer)) {
        return [];
    }

    if (sources.length === 0) {
        return [];
    }

    // If only 1 document was retrieved by the agent search, return it directly
    if (sources.length === 1) {
        return [{ documentId: sources[0].documentId, fileName: sources[0].fileName }];
    }

    // For multiple retrieved documents: distinguish the truly grounded documents from noise
    const cleanAnswer = answer.replace(/[^\w\s-]/g, ' ');
    const answerWords = cleanAnswer.split(/\s+/).filter((w) => w.length >= 3);

    if (answerWords.length === 0) {
        return [{ documentId: sources[0].documentId, fileName: sources[0].fileName }];
    }

    const scoredSources = sources.map((src, index) => {
        const excerptText = (src.excerpts || [])
            .join(' ')
            .toLowerCase()
            .replace(/[^\w\s-]/g, ' ');
        const excerptWordList = excerptText.split(/\s+/).filter((w) => w.length >= 3);
        const excerptWordSet = new Set(excerptWordList);

        // 1. Vocabulary overlap (distinct matching words)
        let wordScore = 0;
        const matchedWords = new Set();
        for (const word of answerWords) {
            if (excerptWordSet.has(word) && !matchedWords.has(word)) {
                matchedWords.add(word);
                // Longer content words give higher confidence
                wordScore += word.length >= 5 ? 2 : 1;
            }
        }

        // 2. Bigram phrase overlap (consecutive word matches)
        let bigramScore = 0;
        for (let i = 0; i < answerWords.length - 1; i++) {
            const bigram = `${answerWords[i]} ${answerWords[i + 1]}`;
            if (bigram.length >= 8 && excerptText.includes(bigram)) {
                bigramScore += 2;
            }
        }

        // 3. Document name mention bonus
        let nameBonus = 0;
        const baseName = String(src.fileName || '').toLowerCase().replace(/\.[a-z0-9]+$/, '');
        if (baseName.length >= 4 && cleanAnswer.includes(baseName)) {
            nameBonus += 5;
        }

        const totalScore = wordScore + bigramScore + nameBonus;

        return {
            src,
            totalScore,
            index
        };
    });

    const maxScore = Math.max(0, ...scoredSources.map((s) => s.totalScore));

    // If there is zero match with any retrieved document, return empty
    if (maxScore === 0) {
        return [];
    }

    // Only keep documents that achieve at least 45% of the top match score
    const threshold = Math.max(1, maxScore * 0.45);

    return scoredSources
        .filter((item) => item.totalScore >= threshold)
        .sort((a, b) => b.totalScore - a.totalScore || a.index - b.index)
        .slice(0, 3)
        .map(({ src }) => ({
            documentId: src.documentId,
            fileName: src.fileName
        }));
}

/**
 * Normalizes mathematical formulas and equations to clean, readable plain text.
 * Strips raw LaTeX wrappers (\text, \mathrm, \frac, \times, etc.) and bracket delimiters.
 */
export function cleanMathFormatting(text) {
    if (!text || typeof text !== 'string') return '';
    let out = text;

    // 1. Escaped symbols like \%, \$, \&
    out = out.replace(/\\([%$&])/g, '$1');

    // 2. Unpack \text{...}, \mathrm{...}, \mathbf{...}, \mathit{...} first so inner tags don't break outer patterns
    for (let i = 0; i < 4; i++) {
        out = out.replace(/\\(?:text|mathrm|mathbf|mathit)\{([^{}]+)\}/g, '$1');
    }

    // 3. LaTeX \left and \right delimiters
    out = out.replace(/\\left\s*([(\[{|])/g, '$1');
    out = out.replace(/\\right\s*([)\]}|])/g, '$1');

    // 4. Fractions & Square roots
    for (let i = 0; i < 3; i++) {
        out = out.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '($1 / $2)');
    }
    out = out.replace(/\\sqrt\{([^{}]+)\}/g, 'sqrt($1)');

    // 5. Mathematical operators & symbols
    out = out.replace(/\\times/g, '*');
    out = out.replace(/\\cdot/g, '*');
    out = out.replace(/\\div/g, '/');
    out = out.replace(/\\pm/g, '+/-');
    out = out.replace(/\\(?:leq|le)\b/g, '<=');
    out = out.replace(/\\(?:geq|ge)\b/g, '>=');
    out = out.replace(/\\neq\b/g, '!=');
    out = out.replace(/\\approx\b/g, '~');
    out = out.replace(/\\(?:quad|qquad)\b/g, ' ');
    out = out.replace(/\\[,;:!]/g, ' ');

    // 6. Subscripts & superscripts with curly braces
    out = out.replace(/_\{([^{}]+)\}/g, '_$1');
    out = out.replace(/\^\{([^{}]+)\}/g, '^$1');

    // 7. LaTeX block delimiters: \[ ... \], \( ... \), $$ ... $$
    out = out.replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, '$1');
    out = out.replace(/\\\(\s*([\s\S]*?)\s*\\\)/g, '$1');
    out = out.replace(/\$\$\s*([\s\S]*?)\s*\$\$/g, '$1');

    // 8. Single $ ... $ inline math (only if contains math operators to avoid currency collisions)
    out = out.replace(/\$\s*([^$\n]*?[=+\-*/\\^][^$\n]*?)\s*\$/g, '$1');

    // 9. Bracket wrappers surrounding equations: e.g. [ Net Salary = ... ] or [\n Net Salary = ... \n]
    out = out.replace(/\[\s*([\s\S]*?=[^\[\]]*?)\s*\]/g, '$1');

    // 10. Clean remaining stray LaTeX command backslashes and leftover isolated braces
    out = out.replace(/\\([a-zA-Z]+)/g, '$1');
    out = out.replace(/\{([^{}]+)\}/g, '$1');

    // 11. Normalize multiple spaces on single lines and excess blank lines
    out = out.replace(/[ \t]{2,}/g, ' ');
    return out.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Prunes and bounds chat history to fit safely within LLM context windows & rate limits.
 * - Always preserves the latest message (the current turn).
 * - Caps individual historical messages (default: 1,500 chars / ~375 tokens).
 * - Traverses backwards from most recent prior message to older messages.
 * - Halts when total character budget (default: 10,000 chars / ~2,500 tokens) is reached.
 */
export function pruneConversationHistory(messages, options = {}) {
    if (!Array.isArray(messages) || messages.length === 0) return [];

    const maxTotalChars = options.maxTotalChars || 10000;
    const maxMsgChars = options.maxMsgChars || 1500;
    const maxCurrentMsgChars = options.maxCurrentMsgChars || 4000;

    const latestMessage = messages[messages.length - 1];
    const priorMessages = messages.slice(0, -1);

    const formattedLatest = {
        role: latestMessage.role,
        content: String(latestMessage.content || '').slice(0, maxCurrentMsgChars)
    };

    let usedChars = formattedLatest.content.length;
    const prunedPrior = [];

    for (let i = priorMessages.length - 1; i >= 0; i--) {
        const msg = priorMessages[i];
        let content = String(msg.content || '').trim();
        if (!content) continue;

        if (content.length > maxMsgChars) {
            content = content.slice(0, maxMsgChars) + '... [truncated]';
        }

        if (usedChars + content.length > maxTotalChars) {
            break;
        }

        usedChars += content.length;
        prunedPrior.unshift({
            role: msg.role,
            content
        });
    }

    return [...prunedPrior, formattedLatest];
}

export async function runAgent(messages, userId, onStep = () => { }, onToken = null) {
    const boundedMessages = pruneConversationHistory(messages);
    const MAX_ITERATIONS = 4;
    const collectedSources = new Map();
    const seenToolCalls = new Set();
    let agentSteps = [];
    // Extract user messages
    const userMessages = boundedMessages.filter((m) => m.role === 'user');
    const latestUserMessage = userMessages[userMessages.length - 1]?.content || '';
    const priorUserMessage = userMessages.length > 1 ? userMessages[userMessages.length - 2]?.content || '' : '';
    const currentWords = String(latestUserMessage)
        .toLowerCase()
        .split(' ')
        .map((word) => word.replaceAll(',', '').replaceAll('.', '').replaceAll('?', '').replaceAll('!', ''))
        .filter(Boolean);
    const needsConversationContext = currentWords.length < 5;
    const relevantContext = needsConversationContext ? priorUserMessage : '';
    // 1. System Prompt with strict grounding and anti-hallucination guarantees
    let currentMessages = [
        {
            role: "system",
            content: `You are an autonomous, strictly factual Document Intelligence AI assistant. 
Factual answers must be grounded exclusively in the user's uploaded documents.
CRITICAL RULES:
1. MANDATORY TOOL USE: For any non-greeting query, you MUST call the "document_search" tool first. Zero internal knowledge allowed for factual/conceptual content.
2. GROUNDING & REFUSAL: Base all facts strictly on "document_search" results. If data is missing or results are empty, respond EXACTLY: "The uploaded documents do not contain this information."
3. GREETINGS: Pure greetings or conversational pleasantries that do not request document facts, you may answer naturally without calling tools.
4. If a message mixes greeting + factual question, treat it as a factual question and call document_search  first.
5.Use document_search for all document-related queries.
6.Use calculate only for arithmetic when explicitly needed.
7. Never simulate or fabricate tool outputs.
8. STYLE & MATH FORMATTING: Be concise. Answer only the current question. Never use LaTeX syntax (no \text{...}, no \times, no \frac, no \[...\], no \(...\), no $$). Write all formulas, equations, and calculations in clean, readable plain text (for example: Net Salary = Gross Salary - (Gross Salary * 0.12) - LWP Deduction).
`   },
        ...boundedMessages
    ];
    const finish = (finalAnswer) => ({
        finalAnswer: finalAnswer || "The uploaded documents do not contain this information.",
        steps: agentSteps,
        sources: filterGroundedSources(finalAnswer, collectedSources),
        messages: currentMessages
    });

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        console.log(`[Agent Loop] Iteration ${iteration + 1} starting...`);
        const currentToolChoice = "auto";
        // 1. Call Groq with message history and available tools
        const response = await getGroqChatCompletion({
            messages: currentMessages,
            tools: AGENT_TOOLS_CONFIG,
            tool_choice: currentToolChoice
        });
        const responseMessage = response.choices[0].message;
        currentMessages.push(responseMessage);
        // 2. Check if the model wants to call any tool
        if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
            for (const toolCall of responseMessage.tool_calls) {
                let toolResult = "";
                const functionName = toolCall.function?.name || "unknown_tool";
                let functionArgs = {};
                try {
                    functionArgs = JSON.parse(toolCall.function?.arguments || '{}');
                    if (!functionArgs || typeof functionArgs !== 'object' || Array.isArray(functionArgs)) {
                        throw new Error('Tool arguments must be a JSON object');
                    }
                    const callSignature = `${functionName}:${JSON.stringify(functionArgs)}`;
                    console.log(`[Agent Action] Model requested tool: "${functionName}" with args:`, functionArgs);
                    onStep({
                        tool: functionName,
                        arguments: functionArgs,
                        status: getToolStatusMessage(functionName)
                    });
                    if (seenToolCalls.has(callSignature)) {
                        console.log(`[Agent Loop] Detected duplicate tool call: ${callSignature}. Breaking loop.`);
                        toolResult = "This search was already executed above. Use the existing document results to answer the user directly without further tool calls.";
                    } else {
                        seenToolCalls.add(callSignature);
                    }
                    if (!toolResult && functionName === "document_search") {
                        const searchRes = await executeDocumentSearch({
                            query: functionArgs.query,
                            userId: userId,
                            conversationContext: relevantContext
                        })
                        toolResult = searchRes.text;
                        // Collect grounded sources for frontend and DB
                        if (searchRes.sources && Array.isArray(searchRes.sources)) {
                            for (const src of searchRes.sources) {
                                if (src.documentId && !collectedSources.has(src.documentId.toString())) {
                                    collectedSources.set(src.documentId.toString(), src);
                                } else if (src.documentId && src.excerpts) {
                                    const existing = collectedSources.get(src.documentId.toString());
                                    existing.excerpts = [...(existing.excerpts || []), ...(src.excerpts || [])];
                                }
                            }
                        }
                    } else if (!toolResult && functionName === "list_user_documents") {
                        toolResult = await executeListUserDocuments({ userId });
                    } else if (!toolResult && functionName === "calculate") {
                        toolResult = executeCalculator({ expression: functionArgs.expression });
                    } else if (!toolResult) {
                        toolResult = `Error: Unknown tool name ${functionName}`;
                    }
                } catch (error) {
                    console.error(`[Agent Tool] Failed to execute ${functionName}:`, error.message);
                    toolResult = `Tool execution error: ${error.message}`;
                }
                if (typeof toolResult === 'string' && toolResult.length > 6000) {
                    toolResult = toolResult.slice(0, 6000) + '\n... [additional search results truncated to preserve context budget]';
                }
                agentSteps.push({
                    tool: functionName,
                    input: functionArgs,
                    output: typeof toolResult === 'string' ? toolResult.slice(0, 500) : toolResult
                });
                currentMessages.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    name: functionName,
                    content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult)
                });
            }

            // Give the model another turn with the tool output before answering
            continue;
        }

        // 3. If no tool calls requested, the model has completed all searches and generated the final answer
        console.log(`[Agent Loop] Final answer generated successfully.`);
        const rawContent = responseMessage.content || "The uploaded documents do not contain this information.";
        const answerText = cleanMathFormatting(rawContent);
        if (onToken && answerText) {
            const tokens = answerText.trim().match(/\S+\s*/g) || [answerText];
            for (const token of tokens) {
                const keepGoing = onToken(token);
                if (keepGoing === false) break;
                await new Promise((resolve) => setTimeout(resolve, 25));
            }
        }
        return finish(answerText);
    }

    // Fallback if max iterations reached
    console.log(`[Agent Loop] Reached max iterations, generating final answer...`);
    if (onToken) {
        const stream = await getGroqChatCompletionStream({
            messages: currentMessages,
            tools: [],
            tool_choice: "none"
        });
        let streamedAnswer = "";
        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content || "";
            if (delta) {
                streamedAnswer += delta;
                onToken(delta);
            }
        }
        return finish(cleanMathFormatting(streamedAnswer));
    } else {
        return finish("The uploaded documents do not contain this information.");
    }
}
// Helper to send friendly status updates to the UI
function getToolStatusMessage(toolName) {
    switch (toolName) {
        case 'document_search': return 'Searching documents & records...';
        case 'list_user_documents': return ' Checking uploaded files catalog...';
        case 'calculate': return ' Performing precise calculation...';
        default: return 'Processing agent action...';
    }
}