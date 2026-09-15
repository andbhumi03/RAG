// Universal Text Sanitizer for Raw PDF / OCR Text
// Strips layout grid noise, pipe symbols, and normalizes split-character spacing
export function sanitizePdfText(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';
  let text = rawText;
  // 1. Strip non-printable control characters & zero-width chars (preserve \n and \t)
  text = text.replace(
    /[\uFEFF\u200B-\u200D\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,
    ''
  );
  // 2. Strip OCR noise glyphs, boxes, bullets, and geometric icons
  text = text.replace(/[□■•○▼●·◆◇★☆☑☒✓✔✗✘]/g, ' ');
  // 3. Strip layout grid borders and separator lines (e.g., |---|---|, +---+---+, |===|===|, |___|)
  text = text.replace(/^[ \t]*[|+]?[-=_|+ ]{3,}[|+]?[ \t]*$/gm, '');
  // 4. Merge split-characters separated by pipe with optional whitespace
  // e.g. "s | u | d | o" -> "sudo", "a | p | t | - | g | e | t" -> "apt-get", "B | h | u | m | i | k | a" -> "Bhumika"
  text = text.replace(
    /(?<!\S)([a-zA-Z0-9_\-\./\+:])(?:\s*\|\s*([a-zA-Z0-9_\-\./\+:]))+(?!\S)/g,
    (match) => {
      return match.replace(/\s*\|\s*/g, '');
    }
  );




  // Iterative pass to collapse any remaining single-character pipe fragments
  for (let i = 0; i < 5; i++) {
    const prev = text;
    text = text.replace(
      /(?<=\b[a-zA-Z0-9_])\s*\|\s*(?=[a-zA-Z0-9_]\b)/g,
      ''
    );
    if (text === prev) break;
  }

  // 5. Merge space-fragmented single letters (OCR scan fragmentation)
  for (let i = 0; i < 4; i++) {
    const prev = text;
    text = text.replace(
      /(?<!\S)([a-zA-Z0-9])(?: ([a-zA-Z0-9])){2,}(?!\S)/g,
      (match) => {
        return match.replace(/ /g, '');
      }
    );
    // Single 2-letter tokens like "P a t i l" -> "Patil"
    text = text.replace(/(?<=\b[a-zA-Z0-9])\s(?=[a-zA-Z0-9]\b)/g, '');
    if (text === prev) break;
  }
  // 6. Strip all remaining pipe symbols ('|') to remove table column dividers cleanly
  text = text.replace(/\|+/g, ' ');
  // 7. Clean up multiple spaces and empty lines, preserving code blocks, numbers, and data rows
  text = text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
  return text.trim();
}

export const cleanOCRText = sanitizePdfText;
export default sanitizePdfText;
