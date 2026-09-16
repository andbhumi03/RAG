import express from 'express';
import mongoose from 'mongoose';
import Chat from "../models/Chat.js";
import Chunk from '../models/Chunk.js';
import Message from "../models/Messages.js";
import authMiddleware from '../middleware/auth.js';
import { generateAnswer } from '../services/groq.js';
import { runAgent } from '../services/agent/agentRunner.js';
const router = express.Router();
const MIN_RELEVANCE_SCORE = Number(process.env.RAG_MIN_RELEVANCE_SCORE || 0.20);
const redactSensitiveText = (value) => String(value ?? '')
  .replace(/(api[_ -]?key|secret|password|token|authorization)\s*[:=]\s*\S+/gi, '$1: [redacted]')
  .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
  .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[redacted payment number]')
  .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[redacted personal number]');
const makeTitleFallback = (question) => {
  const words = redactSensitiveText(question).replace(/[^\w\s'-]/g, '').trim().split(/\s+/).slice(0, 7);
  return words.length ? words.join(' ') : 'Document question';
};
const FALLBACK_EMPTY_ANSWER = "I was unable to find or generate a suitable response based on the uploaded documents. Please try rephrasing your question or checking your document context.";
function formatUserFriendlyErrorMessage(err) {
  if (!err) return "Unable to generate a response at this time. Please try again.";
  let message = "";
  let status = err.status || err.statusCode || null;
  let code = err.code || err.type || "";
  if (typeof err === "string") {
    message = err;
  } else if (err.message) {
    message = err.message;
  }
  // If message contains serialized JSON (e.g., Groq SDK error response or raw error JSON)
  if (typeof message === "string" && (message.trim().startsWith("{") || message.includes('"error"'))) {
    try {
      const match = message.match(/(\{.*\})/s);
      if (match) {
        const parsed = JSON.parse(match[1]);
        if (parsed.error) {
          if (typeof parsed.error === "string") message = parsed.error;
          else if (parsed.error.message) message = parsed.error.message;
          if (parsed.error.code) code = parsed.error.code;
          if (parsed.error.type) code = code || parsed.error.type;
        }
      }
    } catch {
      // not JSON, proceed with raw message
    }
  }

  if (err.error) {
    if (typeof err.error === "string") {
      message = `${message} ${err.error}`;
    } else if (err.error.message) {
      message = `${message} ${err.error.message}`;
      if (err.error.code) code = code || err.error.code;
      if (err.error.type) code = code || err.error.type;
    }
  }
  const lowerMsg = String(message).toLowerCase();
  const lowerCode = String(code).toLowerCase();
  // 1. Rate limits / TPM / RPM / Quota
  const isRateLimit =
    status === 429 ||
    status === 413 ||
    lowerCode.includes("rate_limit") ||
    lowerCode.includes("tokens") ||
    lowerMsg.includes("429") ||
    lowerMsg.includes("rate limit") ||
    lowerMsg.includes("rate_limit") ||
    lowerMsg.includes("tokens per minute") ||
    lowerMsg.includes("tpm") ||
    lowerMsg.includes("rpm") ||
    lowerMsg.includes("quota") ||
    lowerMsg.includes("too large for model") ||
    lowerMsg.includes("reduce your message size") ||
    lowerMsg.includes("billing");
  if (isRateLimit) {
    return "The AI service is currently experiencing high demand. Please wait a few moments and try again.";
  }
  // 2. Model Unavailable / Decommissioned / Overloaded / Network
  const isModelUnavailable =
    status === 404 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    lowerCode.includes("model_not_found") ||
    lowerCode.includes("model_decommissioned") ||
    lowerMsg.includes("model_not_found") ||
    lowerMsg.includes("does not exist") ||
    lowerMsg.includes("not available") ||
    lowerMsg.includes("decommissioned") ||
    lowerMsg.includes("overloaded") ||
    lowerMsg.includes("service unavailable") ||
    lowerMsg.includes("bad gateway") ||
    lowerMsg.includes("econnrefused") ||
    lowerMsg.includes("etimedout") ||
    lowerMsg.includes("fetch failed");

  if (isModelUnavailable) {
    return "The AI assistant is temporarily unavailable. Please try again in a few moments.";
  }
  // 3. Safety / Guardrails / Moderation
  const isSafetyGuardrail =
    lowerCode.includes("content_filter") ||
    lowerCode.includes("safety") ||
    lowerCode.includes("guardrail") ||
    lowerMsg.includes("safety") ||
    lowerMsg.includes("guardrail") ||
    lowerMsg.includes("content filter") ||
    lowerMsg.includes("content_filter") ||
    lowerMsg.includes("moderation") ||
    lowerMsg.includes("blocked");

  if (isSafetyGuardrail) {
    return "I cannot generate a response for this request due to content safety guidelines. Please ask another question about your documents.";
  }
  const isToolChoiceError =
    lowerCode.includes("tool_use_failed") ||
    lowerMsg.includes("tool choice") ||
    lowerMsg.includes("model called a tool");
  if (isToolChoiceError) {
    return "The assistant could not complete this document search. Please try the question again.";
  }
  // 4. Database / Mongo validation / connection errors
  const isDatabaseError =
    lowerMsg.includes("validation failed") ||
    lowerMsg.includes("path 'content'") ||
    lowerMsg.includes("mongo") ||
    lowerMsg.includes("casterror");
  if (isDatabaseError) {
    return "A temporary system error occurred while processing your request. Please try again.";
  }
  // Fallback: Never display raw SDK names, HTTP codes, or JSON dumps
  return "Unable to generate a response from the AI assistant. Please try again.";
}
function extractGroundedSources(answerText, topChunks) {
  if (!answerText || !topChunks.length) return [];
  // 1. Relative threshold calculation based on top score
  const topScore = Math.max(...topChunks.map((item) => item.score || 0));
  const validChunks = topChunks.filter(
    (item) => item.score >= topScore * 0.7 && item.score >= 0.18
  );
  const citationRegex = /\[Source:\s*([^\]]+)\]/gi;
  const citedFileNames = new Set();
  let match;
  while ((match = citationRegex.exec(answerText)) !== null) {
    citedFileNames.add(match[1].trim().toLowerCase());
  }

  const groundedSourcesMap = new Map();

  validChunks.forEach((item) => {
    const doc = item.chunk?.documentId;
    if (doc && doc.fileName) {
      const fileNameLower = doc.fileName.trim().toLowerCase();
      if (citedFileNames.has(fileNameLower) && !groundedSourcesMap.has(doc._id.toString())) {
        groundedSourcesMap.set(doc._id.toString(), {
          documentId: doc._id,
          fileName: doc.fileName
        });
      }
    }
  });
  // 2. Fallback: Agar citation tag omit ho gaya, toh SIRF sabse relevant top 1 document bhejo
  if (
    groundedSourcesMap.size === 0 &&
    !answerText.includes('do not contain this information')
  ) {
    const bestDoc = validChunks[0]?.chunk?.documentId;
    if (bestDoc) {
      groundedSourcesMap.set(bestDoc._id.toString(), {
        documentId: bestDoc._id,
        fileName: bestDoc.fileName
      });
    }
  }

  return Array.from(groundedSourcesMap.values());
}
// Helper: Tokenize and normalize text for Keyword Search
function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ') // Convert '/' or '-' to spaces so 'basic/mo' -> 'basic mo'
    .split(/\s+/)
    .filter((word) => word.length > 1);
}
// Helper: Calculate Keyword Overlap Score (0 to 1)
function calculateKeywordScore(queryTokens, chunkText) {
  const chunkTokens = tokenize(chunkText);
  if (chunkTokens.length === 0 || queryTokens.length === 0) return 0;

  const chunkSet = new Set(chunkTokens);
  let matches = 0;

  for (const token of queryTokens) {
    if (chunkSet.has(token)) {
      matches++;
    }
  }
  return matches / queryTokens.length;
}
// Get all user chat sessions for sidebar
router.get("/sessions", authMiddleware, async (req, res) => {
  try {
    const chats = await Chat.find({ userId: req.userId }).sort({ createdAt: -1 });
    res.json({ chats });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch chat sessions" });
  }
});
// Get messages for a specific chat
router.get("/:chatId/messages", authMiddleware, async (req, res) => {
  try {
    const messages = await Message.find({ chatId: req.params.chatId }).sort({ createdAt: 1 });
    res.json({ messages });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});
// Create new chat session
router.post("/new", authMiddleware, async (req, res) => {
  try {
    const chat = await Chat.create({ userId: req.userId, title: "New Chat" });
    res.json({ chat });
  } catch (error) {
    res.status(500).json({ error: "Failed to create chat" });
  }
});
// Delete a chat session
router.delete("/:chatId", authMiddleware, async (req, res) => {
  try {
    await Chat.deleteOne({ _id: req.params.chatId, userId: req.userId });
    await Message.deleteMany({ chatId: req.params.chatId });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete chat" });
  }
});
// Main /query route with persistent database storage
router.post("/query", authMiddleware, async (req, res) => {
  try {
    let { question, query, chatId } = req.body;
    question = question || query; // Yahan fallback add kar diya
    let chatTitle = null;

    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }
    question = redactSensitiveText(question);
    // 1. Agar Chat ID nahi hai toh Naya Chat Create karein
    if (!chatId) {
      const initialTitle = makeTitleFallback(question);
      const chat = await Chat.create({
        userId: req.userId,
        title: initialTitle,
      });
      chatId = chat._id;
      chatTitle = initialTitle;
    }
    // 2.save user msg in database
    await Message.create({ chatId, role: "user", content: question });

    if (!chatTitle) {
      const existingChat = await Chat.findOne({ _id: chatId, userId: req.userId }).select('title');
      chatTitle = existingChat?.title || 'Document question';
    }

    // 3. Pichli chat history nikal lein taaki agent ko context pata rahe (latest 10 messages)
    const pastMessages = (await Message.find({ chatId }).sort({ createdAt: -1 }).limit(10).lean()).reverse();
    const formattedMessages = pastMessages.map(m => ({
      role: m.role,
      content: m.content
    }));

    // 4. Autonomous Agent Loop Run Karein (ReAct Pattern)
    const agentResult = await runAgent(formattedMessages, req.userId, (step) => {
      console.log('[Agent Step Event]:', step);
    });

    const cleanAnswer = redactSensitiveText(agentResult.finalAnswer);

    // 5. Background mein Chat Title Update karein (agar pehli baar chat bani hai)
    if (chatTitle === 'New Chat' || chatTitle === makeTitleFallback(question)) {
      try {
        const titlePrompt = `Create a concise 3 to 5 word title for this document question. Return only the title, with no punctuation or quotes. Do not include personal data, credentials, or secrets. Question: ${redactSensitiveText(question)}`;
        const cleanTitle = await generateAnswer(titlePrompt);
        if (cleanTitle && cleanTitle.trim()) {
          chatTitle = redactSensitiveText(cleanTitle.trim().replace(/^["']|["']$/g, '')).slice(0, 80);
          await Chat.findByIdAndUpdate(chatId, { title: chatTitle });
        }
      } catch (err) {
        console.error("Failed to generate chat title:", err.message);
      }
    }

    // 6. Assistant ka final jawab DB mein save karein
    const groundedSources = agentResult.sources || [];
    const assistantMsg = await Message.create({
      chatId,
      role: "assistant",
      content: cleanAnswer,
      sources: groundedSources
    });

    // 7. Frontend ko response bhej dein
    res.json({
      chatId,
      chatTitle,
      answer: cleanAnswer,
      sources: groundedSources,
      steps: agentResult.steps, // Agent ne kya-kya steps/tools chalaye, yeh frontend ko dikhega
      message: assistantMsg
    });

  } catch (error) {
    console.error('Query error:', error.message);
    const userMsg = formatUserFriendlyErrorMessage(error);
    res.status(500).json({ error: userMsg });
  }
});

// Streaming /query-stream route
router.post('/query-stream', authMiddleware, async (req, res) => {
  let closed = false;
  let completed = false;
  let chatId = null;

  req.on('aborted', () => {
    if (!completed) {
      closed = true;
      if (!res.writableEnded) res.end();
    }
  });

  res.on('close', () => {
    if (!completed) closed = true;
  });

  try {
    let { question, query, chatId: requestedChatId } = req.body;
    question = question || query;
    chatId = requestedChatId || null;
    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    res.write(': stream-ready\n\n');
    question = redactSensitiveText(question);
    let chatTitle = null;
    if (!chatId) {
      chatTitle = makeTitleFallback(question);
      const chat = await Chat.create({ userId: req.userId, title: chatTitle });
      chatId = chat._id;
    } else {
      const existingChat = await Chat.findOne({ _id: chatId, userId: req.userId }).select('title');
      chatTitle = existingChat?.title || 'Document question';
    }
    // 1. msg is saved in DB for user question
    await Message.create({ chatId, role: 'user', content: question });
    if (closed) return res.end();
    // 2.latest 10 msg history for agent context
    const pastMessages = (await Message.find({ chatId }).sort({ createdAt: -1 }).limit(10).lean()).reverse();
    const formattedMessages = pastMessages.map(m => ({
      role: m.role,
      content: m.content
    }));
    if (closed) return res.end();
    // 3. Run Autonomous Agent Loop with live token streaming callback
    let hasStreamedTokens = false;
    const agentResult = await runAgent(
      formattedMessages,
      req.userId,
      (step) => {
        if (!closed && !res.writableEnded) {
          res.write(`data: ${JSON.stringify({ type: 'step', step })}\n\n`);
        }
      },
      (token) => {
        if (closed || res.writableEnded) return false;
        if (token) {
          hasStreamedTokens = true;
          const cleanChunk = token.replace(/\[Source:\s*[^\]]+\]/gi, '');
          const textToSend = redactSensitiveText(cleanChunk);
          if (textToSend) {
            res.write(`data: ${JSON.stringify({ text: textToSend })}\n\n`);
            if (typeof res.flush === 'function') {
              res.flush();
            }
          }
        }
        return true;
      }
    );
    if (closed) return res.end();
    const rawAnswer = redactSensitiveText(agentResult.finalAnswer);
    let cleanAnswer = rawAnswer.replace(/\[Source:\s*[^\]]+\]/gi, '').trim();
    if (!cleanAnswer) {
      cleanAnswer = FALLBACK_EMPTY_ANSWER;
    }
    // non streaming ans
    if (!hasStreamedTokens) {
      res.write(`data: ${JSON.stringify({ text: cleanAnswer })}\n\n`);
    }
    // 4. msg will be saved in DB with grounded sources
    const groundedSources = agentResult.sources || [];
    await Message.create({
      chatId,
      role: 'assistant',
      content: cleanAnswer,
      sources: groundedSources
    });
    // 5.chat Title
    if (chatTitle === 'New Chat' || chatTitle === makeTitleFallback(question)) {
      try {
        const titlePrompt = `Create a concise 3 to 5 word title for this document question. Return only the title, with no punctuation or quotes. Question: ${question}`;
        const cleanTitle = await generateAnswer(titlePrompt);
        if (cleanTitle?.trim()) {
          chatTitle = redactSensitiveText(cleanTitle.trim().replace(/^["']|["']$/g, '')).slice(0, 80);
          await Chat.findByIdAndUpdate(chatId, { title: chatTitle });
        }
      } catch (titleErr) {
        console.error('Failed to generate chat title:', titleErr.message);
      }
    }
    // 6. Grounded sources and chat meta datasent to frotend
    res.write(`data: ${JSON.stringify({ chatId, chatTitle, sources: groundedSources, steps: agentResult.steps })}\n\n`);
    res.write('data: [DONE]\n\n');
    completed = true;
    res.end();

  } catch (error) {
    console.error('Streaming query error:', error);
    console.error(' Error Message:', error.message);
    const errorMessage = formatUserFriendlyErrorMessage(error);
    if (chatId) {
      try {
        await Message.create({ chatId, role: 'assistant', content: errorMessage, sources: [] });
      } catch (saveError) {
        console.error('Failed to save streaming error message:', saveError.message);
      }
    }
    if (!res.headersSent) {
      return res.status(500).json({ error: errorMessage });
    }
    if (!closed && !res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
      res.write('data: [DONE]\n\n');
    }
    if (!res.writableEnded) {
      res.end();
    }
  }
});
export default router;