import express from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import Document from '../models/Document.js';
import Chunk from '../models/Chunk.js';
import { generateEmbedding } from '../services/embeddings.js';
import { generateAnswer } from '../services/groq.js';
import authMiddleware from '../middleware/auth.js';
import PDFParser from "pdf2json";
import mammoth from 'mammoth';
import { extractTextFromImage } from '../services/ocr.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
// OCR noise, boxes aur broken characters clean karne ke liye helper
function cleanOCRText(rawText) {
  if (!rawText) return '';
  return rawText
    // 1. Table borders aur weird symbols (|, □, ■, •, ○) ko space se replace karo
    .replace(/[|□■•○]/g, ' ')
    // 2. Alag-alag bikhre single letters ko jodo ("A p p l i c a n t" -> "Applicant")
    .replace(/(?<=\b[a-zA-Z])\s+(?=[a-zA-Z]\b)/g, '')
    // 3. Extra spaces aur blank lines clean karo
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();
}

// Helper: Universal Layout-Aware PDF Text Extractor with OCR Fallback
function extractPdfText(buffer) {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser(null, 1);

    // 1. Agar pdf2json parse na kar paye, toh direct OCR chalao
    pdfParser.on("pdfParser_dataError", async (errData) => {
      console.warn("pdf2json failed. Attempting OCR Fallback...", errData.parserError);
      try {
        const ocrText = await extractTextFromImage(buffer);
        resolve(ocrText);
      } catch (ocrErr) {
        reject(ocrErr);
      }
    });

    // 2. Data ready hone par text verify karo
    pdfParser.on("pdfParser_dataReady", async (pdfData) => {
      let fullText = "";

      pdfData.Pages.forEach((page, pageIndex) => {
        let pageText = "";
        const lines = {};

        page.Texts.forEach((textItem) => {
          const y = Math.round(textItem.y * 10) / 10;
          const text = decodeURIComponent(textItem.R[0].T);
          if (!lines[y]) lines[y] = [];
          lines[y].push({ x: textItem.x, text });
        });

        Object.keys(lines)
          .sort((a, b) => parseFloat(a) - parseFloat(b))
          .forEach((y) => {
            const rowText = lines[y]
              .sort((a, b) => a.x - b.x)
              .map((item) => item.text)
              .join(" | ");
            pageText += rowText + "\n";
          });

        if (pageText.trim()) {
          fullText += `--- Page ${pageIndex + 1} ---\n` + pageText;
        }
      });

      // Verification: Agar pdf2json ko bilkul text nahi mila (scanned image PDF hai)
      if (!fullText.replace(/--- Page \d+ ---/g, '').trim()) {
        console.warn("pdf2json extracted 0 text (Scanned PDF). Triggering OCR...");
        try {
          const ocrText = await extractTextFromImage(buffer);
          return resolve(ocrText);
        } catch (ocrErr) {
          return reject(ocrErr);
        }
      }

      resolve(fullText);
    });

    pdfParser.parseBuffer(buffer);
  });
}

function createSmartChunks(text, chunkSize = 600, overlap = 120) {
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

    const merged = [];
    let currentDoc = [];
    let totalLength = 0;

    for (const s of goodSplits) {
      const len = s.length;
      const separatorLength = currentDoc.length > 0 ? separator.length : 0;
      if (totalLength + len + separatorLength > chunkSize) {
        if (currentDoc.length > 0) {
          merged.push(currentDoc.join(separator));
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

function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// POST /api/docs/upload
router.post('/upload', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const mimeType = req.file.mimetype || '';
    const fileName = (req.file.originalname || '').toLowerCase();

    console.log(`Received file: ${req.file.originalname} (${mimeType})`);

    let extractedText = '';

    if (mimeType === 'application/pdf' || fileName.endsWith('.pdf')) {
      extractedText = await extractPdfText(req.file.buffer);
    } else if (
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      fileName.endsWith('.docx')
    ) {
      const docxData = await mammoth.extractRawText({ buffer: req.file.buffer });
      extractedText = docxData.value || '';
    } else if (
      mimeType === 'text/plain' ||
      mimeType === 'application/octet-stream' ||
      mimeType.startsWith('text/') ||
      fileName.endsWith('.txt')
    ) {
      extractedText = req.file.buffer.toString('utf-8').replace(/^\uFEFF/, '');
    } else if (mimeType.startsWith('image/')) {
      extractedText = await extractTextFromImage(req.file.buffer);
    } else {
      return res.status(400).json({ error: 'Only PDF, DOCX, TXT, and Image files are supported' });
    }
    extractedText = cleanOCRText(extractedText);

    if (!extractedText.trim()) {
      return res.status(400).json({ error: 'Failed to extract readable text from file.' });
    }

    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        error: 'Database unavailable',
        details: 'MongoDB is not connected.',
      });
    }

    const newDoc = new Document({
      userId: req.userId,
      fileName: req.file.originalname,
      fileType: mimeType || 'application/octet-stream',
    });
    await newDoc.save();

    const rawChunks = createSmartChunks(extractedText, 600, 120);
    console.log(`Split document into ${rawChunks.length} chunks. Generating embeddings...`);

    const chunkPromises = rawChunks.map(async (text, i) => {
      const embedding = await generateEmbedding(text);
      return Chunk.create({
        documentId: newDoc._id,
        userId: req.userId,
        chunkIndex: i,
        chunkText: text,
        embedding: embedding,
      });
    });

    await Promise.all(chunkPromises);

    console.log(`Document "${req.file.originalname}" saved successfully!`);

    res.status(201).json({
      message: 'Document ingested successfully!',
      documentId: newDoc._id,
      fileName: req.file.originalname,
      totalChunks: rawChunks.length,
    });
  } catch (error) {
    console.error('Ingestion Detailed Error:', error);
    res.status(500).json({ error: 'Failed to ingest document', details: error.message });
  }
});

// POST /api/chat/query
router.post('/query', authMiddleware, async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    const trimmed = question.trim().toLowerCase();
    const commonGreetings = ['hi', 'hello', 'hey', 'hi there', 'greetings', 'namaste'];

    if (commonGreetings.includes(trimmed)) {
      return res.json({
        answer: "Hello! How can I help you with your documents today?",
        sources: [],
      });
    }

    const MIN_RELEVANCE_SCORE = Number(process.env.RAG_MIN_RELEVANCE_SCORE || 0.35);
    const questionEmbedding = await generateEmbedding(question);
    const chunks = await Chunk.find({ userId: req.userId }).populate('documentId');

    let topChunks = [];

    if (chunks.length > 0) {
      const scored = chunks.map((chunk) => {
        let score = cosineSimilarity(questionEmbedding, chunk.embedding);

        const words = trimmed.split(/\s+/).filter(w => w.length > 3);
        const matchCount = words.filter(w => chunk.chunkText.toLowerCase().includes(w)).length;
        if (matchCount > 0) {
          score += (matchCount * 0.08);
        }

        return { chunk, score };
      });

      scored.sort((a, b) => b.score - a.score);

      topChunks = scored.filter((item) => item.score >= MIN_RELEVANCE_SCORE).slice(0, 4);
    }

    if (topChunks.length === 0) {
      return res.json({
        answer: "The uploaded documents do not contain this information.",
        sources: [],
      });
    }

    const context = topChunks
      .map((item, i) => {
        const text = item.chunk.chunkText;
        const truncated = text.length > 1000 ? text.slice(0, 1000) + '...' : text;
        return `[Chunk ${i + 1} (Score: ${item.score.toFixed(2)}) from ${item.chunk.documentId?.fileName || 'document'}]:\n${truncated}`;
      })
      .join('\n\n');

    const prompt = `You are an intelligent, factual AI assistant.

Instructions:
- Base your answer ONLY on the Document Context below.
- Treat dates, numbers, employee details, and table entries as exact truths.
- If the context contains sufficient information, extract and compute the requested details directly.
- Only say "The uploaded documents do not contain this information." if the context has no relevant details.

Document Context:
${context}

User Question: ${question}`;

    const answer = await generateAnswer(prompt);

    const uniqueSourcesMap = new Map();
    topChunks.forEach((item) => {
      const doc = item.chunk?.documentId;
      if (doc && !uniqueSourcesMap.has(doc._id.toString())) {
        uniqueSourcesMap.set(doc._id.toString(), {
          documentId: doc._id,
          fileName: doc.fileName,
        });
      }
    });

    const sources = Array.from(uniqueSourcesMap.values());

    res.json({ answer, sources });
  } catch (error) {
    console.error('Query error:', error.message);
    res.status(500).json({ error: 'Failed to process query' });
  }
});

export default router;