import mongoose from 'mongoose';
import Chunk from '../../models/Chunk.js';
import Document from '../../models/Document.js'; // Document model for listing user files
import { generateEmbedding as getEmbeddings } from '../embeddings.js';

// Helper to extract clean keywords, handle singular/plural and strip conversational stop words
function extractKeywords(text) {
    const stopWords = new Set([
        'the', 'is', 'are', 'in', 'at', 'of', 'on', 'for', 'to', 'a', 'an',
        'and', 'or', 'how', 'many', 'what', 'who', 'which', 'there', 'them',
        'name', 'list', 'details', 'tell', 'show', 'give', 'me', 'please'
    ]);
    return String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 1 && !stopWords.has(w))
        .map(w => (w.endsWith('s') && w.length > 3 ? w.slice(0, -1) : w));
}

// 1. Tool Implementation: Document Search (Atlas Vector Search + Keyword Hybrid)
export async function executeDocumentSearch({ query, userId, conversationContext = "" }) {
    try {
        console.log(`🔎 [Agent Tool] Searching documents for query: "${query}"`);

        const userObjectId = new mongoose.Types.ObjectId(userId);
        let effectiveQuery = String(query || '').trim();

        // If query is short or a follow-up (e.g. "name them", "who", "details"), combine with conversation context
        const cleanTerms = extractKeywords(effectiveQuery);
        if (cleanTerms.length <= 1 && conversationContext) {
            effectiveQuery = `${conversationContext} ${effectiveQuery}`.trim();
        }

        const queryEmbedding = await getEmbeddings(effectiveQuery);
        const keywords = extractKeywords(effectiveQuery);

        // 1. MongoDB Atlas Native Vector Search
        const vectorMatches = await Chunk.aggregate([
            {
                $vectorSearch: {
                    index: "RAG",
                    path: "embedding",
                    queryVector: queryEmbedding,
                    numCandidates: 100,
                    limit: 10,
                    filter: { userId: userObjectId }
                }
            },
            {
                $project: {
                    chunkText: 1,
                    documentId: 1,
                    pageNumber: 1,
                    chunkIndex: 1,
                    score: { $meta: "vectorSearchScore" }
                }
            },
            {
                $lookup: {
                    from: "documents",
                    localField: "documentId",
                    foreignField: "_id",
                    as: "doc"
                }
            },
            {
                $unwind: {
                    path: "$doc",
                    preserveNullAndEmptyArrays: true
                }
            }
        ]);

        // 2. Keyword Search for exact identifiers, roll numbers (CS-xxx), employee IDs (EMP-xxx), names
        let keywordMatches = [];
        if (keywords.length > 0) {
            keywordMatches = await Chunk.find({
                userId: userObjectId,
                $or: keywords.map(kw => ({
                    chunkText: { $regex: new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }
                }))
            })
                .select('chunkText documentId pageNumber chunkIndex')
                .populate('documentId')
                .limit(10)
                .lean();
        }

        // 3. Deduplicate and collect unique sources
        const seenIds = new Set();
        const allResults = [];
        const sourcesMap = new Map();

        for (const match of vectorMatches) {
            const id = match._id.toString();
            seenIds.add(id);
            const fileName = match.doc?.fileName || "Document";
            const docId = match.doc?._id?.toString() || match.documentId?.toString();
            if (docId) {
                if (!sourcesMap.has(docId)) {
                    sourcesMap.set(docId, { documentId: docId, fileName, excerpts: [] });
                }
                sourcesMap.get(docId).excerpts.push(match.chunkText || '');
            }
            allResults.push({
                id,
                fileName,
                pageNumber: match.pageNumber,
                chunkIndex: match.chunkIndex,
                chunkText: match.chunkText
            });
        }

        for (const match of keywordMatches) {
            const id = match._id.toString();
            if (!seenIds.has(id)) {
                seenIds.add(id);
                const fileName = match.documentId?.fileName || "Document";
                const docId = match.documentId?._id?.toString();
                if (docId) {
                    if (!sourcesMap.has(docId)) {
                        sourcesMap.set(docId, { documentId: docId, fileName, excerpts: [] });
                    }
                    sourcesMap.get(docId).excerpts.push(match.chunkText || '');
                }
                allResults.push({
                    id,
                    fileName,
                    pageNumber: match.pageNumber,
                    chunkIndex: match.chunkIndex,
                    chunkText: match.chunkText
                });
            }
        }

        if (allResults.length === 0) {
            return {
                text: "No relevant documents found for this query.",
                sources: []
            };
        }

        const formattedContext = allResults
            .map((r, idx) => `[Document: ${r.fileName} | Result ${idx + 1}]:\n${r.chunkText}`)
            .join("\n\n---DX---\n\n");

        return {
            text: formattedContext,
            sources: Array.from(sourcesMap.values())
        };
    } catch (error) {
        console.error("❌ Error in document_search tool:", error);
        return {
            text: "No relevant documents found for this query.",
            sources: []
        };
    }
}

// 2. Tool Implementation: List User Documents
export async function executeListUserDocuments({ userId }) {
    try {
        console.log(`📁 [Agent Tool] Listing documents for user: ${userId}`);
        const documents = await Document.find({ userId }).select('fileName createdAt');
        if (!documents || documents.length === 0) {
            return "No documents uploaded by this user yet.";
        }
        return JSON.stringify(documents);
    } catch (error) {
        console.error("❌ Error in list_user_documents tool:", error);
        return `Error listing documents: ${error.message}`;
    }
}

// 3. Tool Implementation: Secure Calculator
export function executeCalculator({ expression }) {
    try {
        console.log(`🧮 [Agent Tool] Calculating expression: "${expression}"`);
        // Basic safety check: only allow numbers and standard mathematical operators
        if (!/^[0-9+\-*/().\s]+$/.test(expression)) {
            return "Error: Invalid characters in mathematical expression.";
        }
        // Evaluate safely
        const result = Function(`'use strict'; return (${expression})`)();
        return `Calculation Result: ${result}`;
    } catch (error) {
        return `Error evaluating math expression: ${error.message}`;
    }
}

// 4. Definitions for Groq Model (Tool Schemas)
export const AGENT_TOOLS_CONFIG = [
    {
        type: "function",
        function: {
            name: "document_search",
            description: "Search user uploaded documents (payroll records, employee directories, company policies) using semantic search.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "The specific search query, e.g., 'EMP-207 salary' or 'employee details'"
                    }
                },
                required: ["query"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "list_user_documents",
            description: "List the uploaded documents for the current user.",
            parameters: {
                type: "object",
                properties: {},
                additionalProperties: false
            }
        }
    },
    {
        type: "function",
        function: {
            name: "calculate",
            description: "Perform precise arithmetic calculations for payroll, PF, or loss of pay (LWP). Use standard math expressions.",
            parameters: {
                type: "object",
                properties: {
                    expression: {
                        type: "string",
                        description: "The math expression to evaluate, e.g., '35000 - (35000 / 30 * 1)'"
                    }
                },
                required: ["expression"]
            }
        }
    }
];