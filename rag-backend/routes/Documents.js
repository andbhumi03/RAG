import express from 'express';
import multer from 'multer';
import mammoth from 'mammoth';
import PDFParser from 'pdf2json';
import Document from '../models/Document.js';
import Chunk from '../models/Chunk.js';
import authMiddleware from '../middleware/auth.js';
import { chunkText } from '../services/chunking.js';
import { generateEmbedding } from '../services/embeddings.js';
import { extractTextFromImage } from '../services/ocr.js';
import { sanitizePdfText } from '../services/textSanitizer.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// Helper: Safe PDF Parser using pdf2json without native build issues
const parsePdfBuffer = (buffer) => {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser(null, 1);
    let settled = false;

    const fail = (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };

    pdfParser.on("pdfParser_dataError", (err) => {
      fail(new Error(err.parserError || "Failed to parse PDF structure"));
    });

    pdfParser.on("pdfParser_dataReady", (pdfData) => {
      let fullText = "";

      try {
        if (!pdfData?.Pages?.length) {
          return fail(new Error("PDF does not contain readable pages"));
        }

        pdfData.Pages.forEach((page, pageIndex) => {
          let pageText = "";
          const lines = {};

          page.Texts.forEach((textItem) => {
            const y = Math.round(textItem.y * 10) / 10;

            // PDF text can contain malformed percent escapes.
            let rawText = textItem.R?.[0]?.T || '';
            try {
              rawText = decodeURIComponent(rawText);
            } catch (e) {
              rawText = rawText.replace(/%([0-9A-Fa-f]{2})/g, (match, hex) =>
                String.fromCharCode(parseInt(hex, 16))
              );
            }

            if (!lines[y]) lines[y] = [];
            lines[y].push({ x: textItem.x, text: rawText });
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

        if (!fullText.trim()) {
          return fail(new Error("PDF contains no extractable text"));
        }

        settled = true;
        resolve(fullText);
      } catch (parseEx) {
        fail(parseEx);
      }
    });

    try {
      pdfParser.parseBuffer(buffer);
    } catch (parseEx) {
      fail(parseEx);
    }
  });
};

// 1. Fetch All Documents
router.get('/', authMiddleware, async (req, res) => {
  try {
    const documents = await Document.find({ userId: req.userId }).sort({ uploadDate: -1 });
    const docsWithCreatedAt = documents.map(doc => {
      const obj = doc.toObject ? doc.toObject() : doc;
      if (!obj.createdAt) obj.createdAt = obj.uploadDate;
      return obj;
    });
    res.json({ documents: docsWithCreatedAt });
  } catch (error) {
    console.error('Fetch documents error:', error);
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

// 2. Upload & Process Document (POST /api/documents/upload)
router.post('/upload', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    let extractedText = '';
    const fileName = req.file.originalname;
    const fileExt = fileName.split('.').pop().toLowerCase();
    const mimeType = req.file.mimetype || '';

    try {
      if (fileExt === 'pdf' || mimeType === 'application/pdf') {
        extractedText = await parsePdfBuffer(req.file.buffer);
      } else if (fileExt === 'docx' || mimeType.includes('officedocument')) {
        const result = await mammoth.extractRawText({ buffer: req.file.buffer });
        extractedText = result.value || '';
      } else if (fileExt === 'txt' || mimeType.startsWith('text/')) {
        extractedText = req.file.buffer.toString('utf-8').replace(/^\uFEFF/, '');
      } else if (['jpg', 'jpeg', 'png', 'webp'].includes(fileExt) || mimeType.startsWith('image/')) {
        extractedText = await extractTextFromImage(req.file.buffer);
      } else {
        return res.status(400).json({
          error: 'Unsupported file format. Please upload PDF, DOCX, TXT, or Image.'
        });
      }
    } catch (parseErr) {
      console.error('File Parsing/OCR Error:', parseErr.message);
      return res.status(400).json({ error: 'Failed to extract text from file: ' + parseErr.message });
    }

    extractedText = sanitizePdfText(extractedText);

    if (!extractedText || !extractedText.trim()) {
      return res.status(400).json({
        error: 'Failed to upload document. Ensure file is not scanned and is readable.'
      });
    }

    // Text Chunking
    const chunks = chunkText ? chunkText(extractedText) : [extractedText];
    if (!chunks || chunks.length === 0) {
      return res.status(400).json({ error: 'Failed to split document into chunks.' });
    }

    // Batch Processing Embeddings
    const BATCH_SIZE = 4;
    const chunkDocs = [];

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.all(
        batch.map(async (chunkItem) => {
          if (!chunkItem || !chunkItem.trim()) return null;
          try {
            const embedding = await generateEmbedding(chunkItem);
            if (!Array.isArray(embedding) || embedding.length === 0) {
              throw new Error('Embedding service returned an empty vector');
            }

            return {
              userId: req.userId,
              chunkText: chunkItem,
              embedding: embedding,
            };
          } catch (embErr) {
            throw new Error(`Embedding generation failed: ${embErr.message}`);
          }
        })
      );

      chunkDocs.push(...batchResults);
    }

    if (chunkDocs.length === 0) {
      return res.status(502).json({ error: 'Failed to generate embeddings for the extracted PDF text.' });
    }

    // Save the document only after extraction and embeddings have succeeded.
    const document = await Document.create({
      userId: req.userId,
      fileName,
      chunkCount: chunkDocs.length,
      status: 'processed',
      createdAt: new Date(),
    });

    await Chunk.insertMany(chunkDocs.map((chunk) => ({
      ...chunk,
      documentId: document._id,
    })));

    return res.status(201).json({
      documentId: document._id,
      fileName: document.fileName,
      status: document.status,
      chunkCount: chunkDocs.length,
      uploadDate: document.createdAt,
    });

  } catch (error) {
    console.error('CRITICAL UPLOAD ERROR:', error);
    return res.status(500).json({ error: error.message || 'Failed to process document' });
  }
});

// 3. Delete Document
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const documentId = req.params.id;
    const userId = req.userId || req.user?.id;

    const deletedDoc = await Document.findOneAndDelete({
      _id: documentId,
      userId: userId
    });

    if (!deletedDoc) {
      return res.status(404).json({
        error: 'Document not found or access denied (Unauthorized)'
      });
    }

    await Chunk.deleteMany({ documentId: documentId, userId: userId });

    return res.json({
      documentId,
      deleted: true,
      message: 'Document and vector embeddings deleted successfully.'
    });

  } catch (error) {
    console.error('Delete document error:', error);
    return res.status(500).json({ error: 'Failed to delete document' });
  }
});

// 4. Fetch Document Chunks (GET /api/documents/:id/chunks)
router.get('/:id/chunks', authMiddleware, async (req, res) => {
  try {
    const documentId = req.params.id;
    const userId = req.userId;

    const doc = await Document.findOne({ _id: documentId, userId });
    if (!doc) {
      return res.status(404).json({ error: 'Document not found or unauthorized' });
    }

    const chunks = await Chunk.find({ documentId, userId });
    return res.json({ chunks });
  } catch (error) {
    console.error('Fetch document chunks error:', error);
    return res.status(500).json({ error: 'Failed to fetch document chunks' });
  }
});

export default router;