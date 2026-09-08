// similarity.js

// Measures how "close in meaning" two embeddings are (1 = identical, 0 = unrelated)
export function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  return isNaN(similarity) ? 0 : similarity;
}

/**
 * Filter and rank document chunks based on score threshold
 * @param {Array} queryEmbedding 
 * @param {Array} documentChunks - Array of { text, metadata, embedding }
 * @param {number} topK - Max chunks to retrieve
 * @param {number} minThreshold - Cosine cutoff (0.70 recommended)
 */
export function getRelevantChunks(queryEmbedding, documentChunks, topK = 4, minThreshold = 0.70) {
  return documentChunks
    .map(chunk => ({
      ...chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding)
    }))
    .filter(chunk => chunk.score >= minThreshold) // Drops irrelevant sources
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}