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

    const answerTokens = new Set(
        answer.toLowerCase().match(/[a-z0-9]{4,}/g) || []
    );
    const matched = sources.filter((src) => {
        const fileName = String(src.fileName || '').toLowerCase();
        const baseName = fileName.replace(/\.[a-z0-9]+$/, '');
        if (baseName && answer.toLowerCase().includes(baseName)) {
            return true;
        }
        const excerptText = (src.excerpts || []).join(' ').toLowerCase();
        const excerptTokens = excerptText.match(/[a-z0-9]{4,}/g) || [];
        let hits = 0;
        for (const token of excerptTokens) {
            if (answerTokens.has(token)) hits += 1;
            if (hits >= 6) return true;
        }
        return false;
    });

    const picked = matched.length > 0 ? matched : [];
    return picked.map(({ documentId, fileName }) => ({ documentId, fileName }));
}

export async function runAgent(messages, userId, onStep = () => { }, onToken = null) {
    const MAX_ITERATIONS = 4;
    const collectedSources = new Map();
    const seenToolCalls = new Set();
    let agentSteps = [];

    // Extract user messages
    const userMessages = messages.filter((m) => m.role === 'user');
    const latestUserMessage = userMessages[userMessages.length - 1]?.content || '';

    // Only attach prior user context if the latest query is an ambiguous follow-up (e.g. "name them")
    const isAmbiguousFollowUp = /^(name them|who are they|list them|details|tell me more|what about them|which ones)\b/i.test(latestUserMessage.trim());
    const priorUserMessage = userMessages.length > 1 ? userMessages[userMessages.length - 2]?.content || '' : '';
    const relevantContext = isAmbiguousFollowUp ? priorUserMessage : '';

    // Check if query is an explicit document list request or simple greeting
    const isListDocs = /\b(what (files|documents)|list (my |uploaded )?(files|documents)|which (files|documents))\b/i.test(latestUserMessage);
    const isGreeting = /^(hi|hello|hey|greetings|who are you)\b/i.test(latestUserMessage.trim());

    // Check if question asks for arithmetic/calculation
    const needsCalculation = /\b(calculate|net salary|pf|lwp|tax|deduction|formula|sum|percentage|difference)\b/i.test(latestUserMessage);

    // Force document_search on iteration 0 for factual/data queries
    let forcedToolChoice = 'auto';
    if (!isGreeting && !isListDocs) {
        forcedToolChoice = {
            type: 'function',
            function: { name: 'document_search' }
        };
    }

    // 1. System Prompt with strict grounding and anti-hallucination guarantees
    let currentMessages = [
        {
            role: "system",
            content: `You are an autonomous, strictly factual Document Intelligence AI assistant.
Your answers must be grounded EXCLUSIVELY in the user's uploaded documents.

====================== CRITICAL ANTI-HALLUCINATION RULES ======================
1. ABSOLUTE TRUTH & GROUNDING: Base all factual statements, names, numbers, and statuses strictly on data returned by the "document_search" tool.
2. ZERO TOLERANCE FOR FAKE DATA: Under NO circumstances should you invent, assume, or guess any names, roll numbers, or figures. NEVER output fictional placeholder names (such as Charlie Brown, Ethan Hunt, Hannah Lee, Alice, Bob). Every name you state MUST exist verbatim in the document search output.
3. MISSING INFORMATION: If document search results do not contain the requested information, state truthfully: "The uploaded documents do not contain this information."

====================== CONVERSATIONAL & RELEVANCE RULES ======================
1. CONCISE & DIRECT: Answer ONLY the user's current question directly. Do NOT output unsolicited extra tables, previous turn answers, or long preambles. Keep answers crisp and focused.
2. FOLLOW-UP QUESTIONS: When the user asks a follow-up question (such as "name them", "who are they"), use the context of previous messages to answer for that specific topic.
3. ALWAYS SEARCH FIRST: For any question about document contents, employees, students, attendance, policies, or records, call "document_search" before answering.
4. CALCULATION: Use the "calculate" tool for arithmetic calculations if needed.
5. FORMATTING: Use clean Markdown only. Do not use LaTeX delimiters like \\[ ... \\]. Do not include raw internal tags like ---DX---.`
        },
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

        let currentToolChoice = "auto";
        if (iteration === 0) {
            currentToolChoice = forcedToolChoice;
        } else if (iteration >= MAX_ITERATIONS - 1) {
            currentToolChoice = "none";
        }

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
                const functionName = toolCall.function.name;
                const functionArgs = JSON.parse(toolCall.function.arguments || '{}');
                const callSignature = `${functionName}:${JSON.stringify(functionArgs)}`;

                console.log(`[Agent Action] Model requested tool: "${functionName}" with args:`, functionArgs);

                onStep({
                    tool: functionName,
                    arguments: functionArgs,
                    status: getToolStatusMessage(functionName)
                });

                // Detect duplicate tool call loop
                if (seenToolCalls.has(callSignature)) {
                    console.log(`[Agent Loop] Detected duplicate tool call: ${callSignature}. Breaking loop.`);
                    currentMessages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        name: functionName,
                        content: "This search was already executed above. Use the existing document results to answer the user directly without further tool calls."
                    });
                    continue;
                }
                seenToolCalls.add(callSignature);

                let toolResult = "";
                if (functionName === "document_search") {
                    const searchRes = await executeDocumentSearch({
                        query: functionArgs.query,
                        userId: userId,
                        conversationContext: relevantContext
                    });

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
                } else if (functionName === "list_user_documents") {
                    toolResult = await executeListUserDocuments({ userId });
                } else if (functionName === "calculate") {
                    toolResult = executeCalculator({ expression: functionArgs.expression });
                } else {
                    toolResult = `Error: Unknown tool name ${functionName}`;
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

            // If calculation is needed and not yet executed, continue to let model call calculate
            if (needsCalculation && ![...seenToolCalls].some((sig) => sig.startsWith("calculate:")) && iteration === 0) {
                continue;
            }

            // Otherwise, we have all necessary observations. Stream or generate final answer directly!
            if (onToken) {
                console.log(`⚡ [Agent Loop] Streaming final answer in real-time...`);
                const stream = await getGroqChatCompletionStream({ messages: currentMessages });
                let streamedAnswer = "";
                for await (const chunk of stream) {
                    const delta = chunk.choices[0]?.delta?.content || "";
                    if (delta) {
                        streamedAnswer += delta;
                        onToken(delta);
                    }
                }
                return finish(streamedAnswer);
            }

            continue;
        }

        // 3. If no tool calls requested, final answer is ready
        console.log(`✅ [Agent Loop] Final answer generated successfully.`);
        const answerText = responseMessage.content || "The uploaded documents do not contain this information.";

        // If onToken callback is present and text wasn't streamed yet, stream the text chunks
        if (onToken && answerText) {
            onToken(answerText);
        }

        return finish(answerText);
    }

    // Fallback if max iterations reached
    console.log(`[Agent Loop] Reached max iterations, generating final answer...`);
    if (onToken) {
        const stream = await getGroqChatCompletionStream({ messages: currentMessages });
        let streamedAnswer = "";
        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content || "";
            if (delta) {
                streamedAnswer += delta;
                onToken(delta);
            }
        }
        return finish(streamedAnswer);
    }

    const finalResponse = await getGroqChatCompletion({
        messages: currentMessages,
        tools: AGENT_TOOLS_CONFIG,
        tool_choice: "none"
    });

    return finish(finalResponse.choices[0]?.message?.content);
}

// Helper to send friendly status updates to the UI
function getToolStatusMessage(toolName) {
    switch (toolName) {
        case 'document_search': return '🔍 Searching documents & records...';
        case 'list_user_documents': return '📁 Checking uploaded files catalog...';
        case 'calculate': return '🧮 Performing precise calculation...';
        default: return '🤖 Processing agent action...';
    }
}
