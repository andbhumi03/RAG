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
  // 4. Merge split-characters separated by pipe with optional whitespace (requires 3+ character run)
  // e.g. "s | u | d | o" -> "sudo", "a | p | t | - | g | e | t" -> "apt-get", "B | h | u | m | i | k | a" -> "Bhumika"
  text = text.replace(
    /(?<!\S)([a-zA-Z0-9_\-\./\+:])(?:\s*\|\s*([a-zA-Z0-9_\-\./\+:])){2,}(?!\S)/g,
    (match) => {
      return match.replace(/\s*\|\s*/g, '');
    }
  );
  // 5. Merge space-fragmented single letters (OCR scan fragmentation).
  // FIX: only the "3+ run" regex is safe to use here. The old second line
  // ("Single 2-letter tokens like 'P a t i l' -> 'Patil'") merged ANY two
  // adjacent single characters unconditionally — which silently destroyed
  // normal English like "I am", "Plan A and Plan B", and "x + y". It has
  // been removed: a run of 3+ single characters (the loop below) already
  // catches genuine OCR fragmentation like "P a t i l" without touching
  // legitimate short words sitting next to each other.
  for (let i = 0; i < 4; i++) {
    const prev = text;
    text = text.replace(
      /(?<!\S)([a-zA-Z])(?: ([a-zA-Z])){2,}(?!\S)/g,
      (match) => {
        return match.replace(/ /g, '');
      }
    );
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