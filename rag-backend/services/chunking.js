// Splits text into overlapping chunks recursively based on separators
export function chunkText(text, chunkSize = 600, overlap = 120) {
  if (!text || typeof text !== 'string') return [];

  const separators = ["\n\n", "\n", " ", ""];

  function getSeparator(text, index) {
    if (index >= separators.length) return "";
    return separators[index];
  }
  function split(text, index) {
    if (text.length <= chunkSize) return [text];
    const separator = getSeparator(text, index);
    if (index >= separators.length) {
      // Force split by character length
      const chunks = [];
      let start = 0;
      while (start < text.length) {
        chunks.push(text.slice(start, start + chunkSize));
        start += chunkSize - overlap;
      }
      return chunks;
    }
    const splits = text.split(separator);
    const goodSplits = [];
    for (const s of splits) {
      if (s.length <= chunkSize) {
        goodSplits.push(s);
      } else {
        goodSplits.push(...split(s, index + 1));
      }
    }
    // Now merge the splits
    const merged = [];
    let currentDoc = [];
    let totalLength = 0;
    for (const s of goodSplits) {
      const len = s.length;
      const separatorLength = currentDoc.length > 0 ? separator.length : 0;
      if (totalLength + len + separatorLength > chunkSize) {
        if (currentDoc.length > 0) {
          merged.push(currentDoc.join(separator));
          // keep overlap
          while (currentDoc.length > 0 && totalLength > overlap) {
            const popped = currentDoc.shift();
            totalLength -= popped.length + (currentDoc.length > 0 ? separator.length : 0);
          }
        }
      }
      currentDoc.push(s);
      totalLength += len + (currentDoc.length > 1 ? separator.length : 0);
    }
    if (currentDoc.length > 0) {
      merged.push(currentDoc.join(separator));
    }
    return merged;
  }

  return split(text, 0);
}