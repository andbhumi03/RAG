import dotenv from 'dotenv';
import { Groq } from 'groq-sdk';

dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const MODEL_NAME = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';

// 1. Normal Answer
export async function generateAnswer(prompt) {
  try {
    const completion = await groq.chat.completions.create({
      model: MODEL_NAME,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    });
    return completion.choices[0]?.message?.content || '';
  } catch (error) {
    console.error('Groq Answer Error:', error.message);
    throw error;
  }
}

// 2. Streaming Answer
export async function generateAnswerStream(prompt) {
  try {
    const response = await groq.chat.completions.create({
      model: MODEL_NAME,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      stream: true,
    });

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
    console.error('Groq Stream Error:', error.message);
    throw error;
  }
}