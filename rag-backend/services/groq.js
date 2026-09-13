import dotenv from 'dotenv';
import { Groq } from 'groq-sdk';

dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const CANDIDATE_MODELS = [
  process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
  'openai/gpt-oss-120b',
  'qwen/qwen3.8-27b',
].filter(Boolean);

function isModelAvailabilityError(err) {
  const msg = String(err?.message || '').toLowerCase();
  const code = String(err?.code || '').toLowerCase();
  const status = err?.status || err?.statusCode;
  return (
    status === 404 ||
    status === 503 ||
    code.includes('model_not_found') ||
    code.includes('model_decommissioned') ||
    msg.includes('model_not_found') ||
    msg.includes('does not exist') ||
    msg.includes('decommissioned') ||
    msg.includes('not available') ||
    msg.includes('service unavailable')
  );
}

function withReasoningOptions(model, options) {
  if (String(model).includes('gpt-oss')) {
    return {
      ...options,
      reasoning_effort: 'low',
      include_reasoning: false,
    };
  }
  return options;
}

// 1. Normal Answer with fallback
export async function generateAnswer(prompt) {
  let lastError = null;
  for (const model of CANDIDATE_MODELS) {
    try {
      const completion = await groq.chat.completions.create(withReasoningOptions(model, {
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
      }));
      return completion.choices[0]?.message?.content || '';
    } catch (error) {
      console.error(`Groq Model (${model}) Error:`, error.message);
      lastError = error;
      if (!isModelAvailabilityError(error)) {
        break;
      }
    }
  }
  throw lastError;
}

// 2. Streaming Answer with fallback
export async function generateAnswerStream(prompt) {
  let lastError = null;
  for (const model of CANDIDATE_MODELS) {
    try {
      const response = await groq.chat.completions.create(withReasoningOptions(model, {
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        stream: true,
      }));

      async function* streamGenerator() {
        for await (const chunk of response) {
          const text = chunk.choices[0]?.delta?.content || '';
          if (text) {
            yield { text: () => text };
          }
        }
      }

      return { stream: streamGenerator() };
    } catch (error) {
      console.error(`Groq Stream Model (${model}) Error:`, error.message);
      lastError = error;
      if (!isModelAvailabilityError(error)) {
        break;
      }
    }
  }
  throw lastError;
}

// 3. Raw Chat Completion with Tools and Fallback (Required for Agentic RAG)
export async function getGroqChatCompletion({ messages, tools, tool_choice }) {
  let lastError = null;
  for (const model of CANDIDATE_MODELS) {
    try {
      const completion = await groq.chat.completions.create(withReasoningOptions(model, {
        model,
        messages,
        tools,
        tool_choice: tool_choice || 'auto',
        temperature: 0.1,
      }));
      return completion;
    } catch (error) {
      console.error(`Groq Tool Model (${model}) Error:`, error.message);
      lastError = error;
      if (!isModelAvailabilityError(error)) {
        break;
      }
    }
  }
  throw lastError;
}

// 4. Raw Chat Completion Stream with Fallback (For Agentic RAG Final Answer Streaming)
export async function getGroqChatCompletionStream({ messages }) {
  let lastError = null;
  for (const model of CANDIDATE_MODELS) {
    try {
      const stream = await groq.chat.completions.create(withReasoningOptions(model, {
        model,
        messages,
        temperature: 0.1,
        stream: true,
      }));
      return stream;
    } catch (error) {
      console.error(`Groq Chat Stream Model (${model}) Error:`, error.message);
      lastError = error;
      if (!isModelAvailabilityError(error)) {
        break;
      }
    }
  }
  throw lastError;
}
