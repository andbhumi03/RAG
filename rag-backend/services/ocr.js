import { createWorker } from 'tesseract.js';

export const extractTextFromImage = async (imageBuffer) => {
  let worker = null;
  try {
    worker = await createWorker('eng');
    const { data: { text } } = await worker.recognize(imageBuffer);
    await worker.terminate();
    return text || '';
  } catch (error) {
    if (worker) await worker.terminate();
    console.error('OCR Processing Error:', error.message);
    return '';
  }
};