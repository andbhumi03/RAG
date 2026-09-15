import mongoose from 'mongoose';
import Chunk from '../../models/Chunk.js';
import Document from '../../models/Document.js'; // Document model for listing user files
import { generateEmbedding as getEmbeddings } from '../embeddings.js';

// 1. Tool Implementation: Document Search (Native Vector Search + Native Full-Text Search with RRF)
export async function executeDocumentSearch({
    query,
    userId,
    conversationContext = '',
}) {
    try {
        console.log(` [Agent Tool] Searching documents for query: "${query}"`);

        const userObjectId = new mongoose.Types.ObjectId(userId);
        let effectiveQuery = String(query || '').trim();

        // If query is short or a follow-up (e.g. "name them", "who", "details"), combine with conversation context
        if (
            conversationContext &&
            effectiveQuery.split(/\s+/).filter(Boolean).length < 5
        ) {
            effectiveQuery = `${conversationContext} ${effectiveQuery}`.trim();
        }

        // 1. MongoDB Atlas Native Vector Search (Dense Semantic Retrieval)
        let vectorMatches = [];
        try {
            const queryEmbedding = await getEmbeddings(effectiveQuery);
            if (Array.isArray(queryEmbedding) && queryEmbedding.length > 0) {
                vectorMatches = await Chunk.aggregate([
                    {
                        $vectorSearch: {
                            index: 'RAG',
                            path: 'embedding',
                            queryVector: queryEmbedding,
                            numCandidates: 100,
                            limit: 10,
                            filter: { userId: userObjectId },
                        },
                    },
                    {
                        $project: {
                            chunkText: 1,
                            documentId: 1,
                            pageNumber: 1,
                            chunkIndex: 1,
                            score: { $meta: 'vectorSearchScore' },
                        },
                    },
                    {
                        $lookup: {
                            from: 'documents',
                            localField: 'documentId',
                            foreignField: '_id',
                            as: 'doc',
                        },
                    },
                    {
                        $unwind: {
                            path: '$doc',
                            preserveNullAndEmptyArrays: true,
                        },
                    },
                ]);
            }
        } catch (vecErr) {
            console.warn(
                '[Agent Tool] Vector search unavailable or failed, continuing with full-text search:',
                vecErr.message
            );
        }

        // 2. Database-Native Full-Text Search ($text with BM25 textScore - NO regexes, NO stop-word lists)
        let textMatches = [];
        try {
            textMatches = await Chunk.find(
                {
                    userId: userObjectId,
                    $text: { $search: effectiveQuery },
                },
                { score: { $meta: 'textScore' } }
            )
                .sort({ score: { $meta: 'textScore' } })
                .select('chunkText documentId pageNumber chunkIndex')
                .populate('documentId')
                .limit(10)
                .lean();
        } catch (textErr) {
            console.warn(
                '[Agent Tool] Native text search unavailable or not indexed:',
                textErr.message
            );
        }

        // 3. Reciprocal Rank Fusion (RRF) - Fusing Dense & Sparse Results
        const RRF_K = 60;
        const rrfScores = new Map();
        const chunkMap = new Map();

        // Score dense vector matches
        vectorMatches.forEach((match, rank) => {
            const id = match._id.toString();
            const score = 1 / (RRF_K + rank + 1);
            rrfScores.set(id, (rrfScores.get(id) || 0) + score);
            chunkMap.set(id, {
                id,
                fileName: match.doc?.fileName || 'Document',
                documentId: match.doc?._id?.toString() || match.documentId?.toString(),
                pageNumber: match.pageNumber,
                chunkIndex: match.chunkIndex,
                chunkText: match.chunkText,
            });
        });

        // Score native full-text matches
        textMatches.forEach((match, rank) => {
            const id = match._id.toString();
            const score = 1 / (RRF_K + rank + 1);
            rrfScores.set(id, (rrfScores.get(id) || 0) + score);
            if (!chunkMap.has(id)) {
                chunkMap.set(id, {
                    id,
                    fileName: match.documentId?.fileName || 'Document',
                    documentId: match.documentId?._id?.toString(),
                    pageNumber: match.pageNumber,
                    chunkIndex: match.chunkIndex,
                    chunkText: match.chunkText,
                });
            }
        });

        // Sort all candidate chunks by fused RRF score descending
        const fusedResults = Array.from(chunkMap.values())
            .sort((a, b) => (rrfScores.get(b.id) || 0) - (rrfScores.get(a.id) || 0))
            .slice(0, 10);

        if (fusedResults.length === 0) {
            return {
                text: 'No relevant documents found for this query.',
                sources: [],
            };
        }

        // 4. Collect unique sources with excerpts for UI grounding
        const sourcesMap = new Map();
        for (const item of fusedResults) {
            const docId = item.documentId;
            if (docId) {
                if (!sourcesMap.has(docId)) {
                    sourcesMap.set(docId, {
                        documentId: docId,
                        fileName: item.fileName,
                        excerpts: [],
                    });
                }
                sourcesMap.get(docId).excerpts.push(item.chunkText || '');
            }
        }

        const formattedContext = fusedResults
            .map(
                (r, idx) =>
                    `[Document: ${r.fileName} | Result ${idx + 1}]:\n${r.chunkText}`
            )
            .join('\n\n---DX---\n\n');

        return {
            text: formattedContext,
            sources: Array.from(sourcesMap.values()),
        };
    } catch (error) {
        console.error(' Error in document_search tool:', error);
        return { text: 'No relevant documents found', sources: [] };
    }
}
// 2. Tool Implementation: List User Documents
export async function executeListUserDocuments({ userId }) {
    try {
        console.log(` [Agent Tool] Listing documents for user: ${userId}`);
        const documents = await Document.find({ userId }).select(
            'fileName createdAt'
        );
        if (!documents || documents.length === 0) {
            return 'No documents uploaded by this user yet.';
        }
        return JSON.stringify(documents);
    } catch (error) {
        console.error(' Error in list_user_documents tool:', error);
        return `Error listing documents: ${error.message}`;
    }
}

export async function executeCountUserDocuments({ userId }) {
    const count = await Document.countDocuments({ userId });
    return count;
}
// 3. Tool Implementation: Secure Calculator
export function executeCalculator({ expression }) {
    try {
        console.log(` [Agent Tool] Calculating expression: "${expression}"`);
        const tokens = String(expression || '').match(
            /\d+(?:\.\d+)?|[()+\-*/]/g
        );
        if (
            !tokens ||
            tokens.join('') !== String(expression || '').replace(/\s+/g, '')
        ) {
            return 'Error: Invalid characters in mathematical expression.';
        }
        const values = [];
        const operators = [];
        const precedence = { '+': 1, '-': 1, '*': 2, '/': 2 };
        const applyOperator = () => {
            const operator = operators.pop();
            const right = values.pop();
            const left = values.pop();
            if (left === undefined || right === undefined)
                throw new Error('Invalid expression');
            if (operator === '+') values.push(left + right);
            if (operator === '-') values.push(left - right);
            if (operator === '*') values.push(left * right);
            if (operator === '/') {
                if (right === 0) throw new Error('Division by zero');
                values.push(left / right);
            }
        };

        for (const token of tokens) {
            if (!Number.isNaN(Number(token))) {
                values.push(Number(token));
            } else if (token === '(') {
                operators.push(token);
            } else if (token === ')') {
                while (operators.length && operators.at(-1) !== '(')
                    applyOperator();
                if (operators.pop() !== '(')
                    throw new Error('Invalid expression');
            } else {
                while (
                    operators.length &&
                    operators.at(-1) !== '(' &&
                    precedence[operators.at(-1)] >= precedence[token]
                ) {
                    applyOperator();
                }
                operators.push(token);
            }
        }
        while (operators.length) {
            if (operators.at(-1) === '(') throw new Error('Invalid expression');
            applyOperator();
        }
        if (values.length !== 1 || !Number.isFinite(values[0]))
            throw new Error('Invalid expression');
        const result = values[0];
        return `Calculation Result: ${result}`;
    } catch (error) {
        return `Error evaluating math expression: ${error.message}`;
    }
}
// 4. Definitions for Groq Model (Tool Schemas)
export const AGENT_TOOLS_CONFIG = [
    {
        type: 'function',
        function: {
            name: 'document_search',
            description:
                'Search user uploaded documents (payroll records, employee directories, company policies) using semantic search.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description:
                            "The specific search query, e.g., 'EMP-207 salary' or 'employee details'",
                    },
                },
                required: ['query'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'list_user_documents',
            description: 'List the uploaded documents for the current user.',
            parameters: {
                type: 'object',
                properties: {},
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'calculate',
            description:
                'Perform precise arithmetic calculations for payroll, PF, or loss of pay (LWP). Use standard math expressions.',
            parameters: {
                type: 'object',
                properties: {
                    expression: {
                        type: 'string',
                        description:
                            "The math expression to evaluate, e.g., '35000 - (35000 / 30 * 1)'",
                    },
                },
                required: ['expression'],
            },
        },
    },
];
