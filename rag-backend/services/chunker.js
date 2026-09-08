/**
 * Pure JS Token-Aware Splitter (800 tokens ~ 3200 chars, 100 tokens ~ 400 chars overlap)
 */
export function createChunks(text, chunkSize = 3200, overlap = 400) {
  if (!text || typeof text !== 'string') return [];

  // Line breaks preserve rakhein, extra carriage return clean karein
  const cleanedText = text.replace(/\r\n/g, '\n').trim();
  const chunks = [];
  let startIndex = 0;

  while (startIndex < cleanedText.length) {
    let endIndex = startIndex + chunkSize;

    // Table protection: Line break (\n) par cut karne ki koshish karein
    if (endIndex < cleanedText.length) {
      const lastNewLine = cleanedText.lastIndexOf('\n', endIndex);
      
      // Agar last 30% area mein newline milti hai toh row ko tootne na dein
      if (lastNewLine > startIndex + chunkSize * 0.7) {
        endIndex = lastNewLine + 1;
      } else {
        // Space par cut karein agar newline na mile
        const lastSpace = cleanedText.lastIndexOf(' ', endIndex);
        if (lastSpace > startIndex + chunkSize * 0.7) {
          endIndex = lastSpace + 1;
        }
      }
    }

    const chunkContent = cleanedText.slice(startIndex, endIndex).trim();

    if (chunkContent.length > 0) {
      chunks.push(chunkContent);
    }

    // Overlap: 400 characters (~100 tokens) piche se agli chunk start karein
    startIndex = endIndex - overlap;

    if (endIndex >= cleanedText.length) break;
  }

  return chunks;
}