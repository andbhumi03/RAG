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
    const answer = String(answerText || '');
    if (!answer.trim() || /do not contain this information/i.test(answer)) {
        return [];
    }

    // Common non-discriminating filler words to ignore when measuring overlap
    const genericNoise = new Set([
        'the', 'and', 'for', 'was', 'with', 'from', 'this', 'that', 'have', 'has',
        'had', 'not', 'are', 'were', 'been', 'which', 'their', 'there', 'they',
        'what', 'when', 'where', 'who', 'how', 'per', 'details', 'information',
        'document', 'uploaded', 'user', 'according', 'based', 'data'
    ]);

    const answerWords = answer.toLowerCase().match(/[a-z0-9_\-]{3,}/g) || [];
    const answerTokens = new Set(answerWords.filter((w) => !genericNoise.has(w)));

    const rankedSources = sources.map((src, index) => {
        const fileName = String(src.fileName || '').toLowerCase();
        const baseName = fileName.replace(/\.[a-z0-9]+$/, '');
        const excerptText = (src.excerpts || []).join(' ').toLowerCase();
        const excerptTokens = new Set(
            (excerptText.match(/[a-z0-9_\-]{3,}/g) || []).filter((w) => !genericNoise.has(w))
        );

        let answerOverlap = 0;
        for (const token of answerTokens) {
            if (excerptTokens.has(token)) {
                answerOverlap++;
            }
        }
        const fileNameMatch = baseName && answer.toLowerCase().includes(baseName) ? 3 : 0;
        return { src, score: answerOverlap + fileNameMatch, index };
    });
    const maxScore = Math.max(0, ...rankedSources.map((s) => s.score));
    if (maxScore < 2) {
        return [];
    }

    // Relative threshold: Only retain documents that have at least 60% of the top score
    // This cleanly discards unrelated documents that only matched 1 random word
    const threshold = Math.max(2, maxScore * 0.6);
    return rankedSources
        .filter(({ score }) => score >= threshold)
        .sort((left, right) => right.score - left.score || left.index - right.index)
        .slice(0, 3)
        .map(({ src }) => ({ documentId: src.documentId, fileName: src.fileName }));
}
export async function runAgent(messages, userId, onStep = () => { }, onToken = null) {
    const MAX_ITERATIONS = 4;
    const collectedSources = new Map();
    const seenToolCalls = new Set();
    let agentSteps = [];
    // Extract user messages
    const userMessages = messages.filter((m) => m.role === 'user');
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
8.STYLE: Be concise. Answer only the current question. Use clean Markdown only (no LaTeX).
`   },
        ...messages
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
        console.log(`✅ [Agent Loop] Final answer generated successfully.`);
        const answerText = responseMessage.content || "The uploaded documents do not contain this information.";
        if (onToken && answerText) {
            const tokens = answerText.match(/\S+\s*/g) || [answerText];
            for (const token of tokens) {
                onToken(token);
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
        return finish(streamedAnswer);
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