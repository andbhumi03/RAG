import { InferenceClient } from "@huggingface/inference"; // 👈 InferenceClient import karein

let hf = null;
const getClient = () => {
  if (!hf) {
    hf = new InferenceClient(process.env.HUGGINGFACE_API_KEY);
  }
  return hf;
};

export const generateEmbedding = async (text) => {
  try {
    const client = getClient();
    const response = await client.featureExtraction({
      model: "BAAI/bge-small-en-v1.5",
      inputs: text,
      provider: "hf-inference",
    });
    return Array.isArray(response[0]) ? response[0] : response;
  } catch (error) {
    console.error("Hugging Face Embedding Error:", error);
    throw error;
  }
};