import { createWorker } from 'tesseract.js';

// The worker is created ONCE and cached here. Every call to
// extractTextFromImage() reuses this same worker instead of paying the
// 3-6 second startup cost on every single page.
let workerPromise = null;

const getWorker = () => {
  if (!workerPromise) {
    workerPromise = createWorker('eng').catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
};

export const extractTextFromImage = async (imageBuffer) => {
  if (!imageBuffer || (Buffer.isBuffer(imageBuffer) && imageBuffer.length === 0)) {
    return '';
  }
  try {
    const worker = await getWorker();
    const { data: { text } } = await worker.recognize(imageBuffer);
    return text || '';
  } catch (error) {
    console.error('OCR Processing Error:', error.message);

    // Terminate the crashed/stale worker process to prevent zombie process leaks
    if (workerPromise) {
      const stalePromise = workerPromise;
      workerPromise = null;
      stalePromise.then((w) => w?.terminate?.()).catch(() => {});
    }
    return '';
  }
};

// Call this once when your server is shutting down (e.g. on SIGTERM),
// NOT after every page or every document. Keeping the worker alive between
// requests is the whole point of this fix.
export const shutdownOcrWorker = async () => {
  if (workerPromise) {
    const currentPromise = workerPromise;
    workerPromise = null;
    try {
      const worker = await currentPromise;
      await worker?.terminate?.();
    } catch (err) {
      console.error('Error shutting down OCR worker:', err.message);
    }
  }
};