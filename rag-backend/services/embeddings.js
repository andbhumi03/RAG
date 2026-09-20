import { pipeline } from "@huggingface/transformers";
// Cache the pipeline so the model loads into memory only ONCE on first use,
// then gets reused for every call after that (loading fresh per request
// would be as wasteful as the OCR worker bug).
let embedderPromise = null;
const getEmbedder = () => {
  if (!embedderPromise) {
    embedderPromise = pipeline("feature-extraction", "Xenova/bge-small-en-v1.5").catch((err) => {
      embedderPromise = null;
      throw err;
    });
  }
  return embedderPromise;
};
export const generateEmbedding = async (text) => {
  try {
    const cleanText = String(text ?? '').trim() || ' ';
    const embedder = await getEmbedder();
    // mean pooling + normalization matches how bge models are meant to be used
    const response = await embedder(cleanText, { pooling: "mean", normalize: true });
    // response.data is a Float32Array — convert to a plain array,
    // matching the same return shape your HF API version produced.
    return Array.from(response.data);
  } catch (error) {
    console.error("Local Embedding Error:", error?.message || error);
    throw error;
  }
};