# RAG Assistant Starter - AI-Powered Document Intelligence and Chat
RAG Assistant is an enterprise-ready, full-stack Document Intelligence and Retrieval-Augmented Generation (RAG) platform. Built with a React + Vite frontend and a Node.js/Express backend connected to MongoDB Atlas, it provides autonomous agent reasoning, hybrid semantic search, multi-format document ingestion, real-time word-by-word streaming, and strict anti-hallucination factual grounding.
## Prerequisites
* Node.js (v18 or higher)
* MongoDB Atlas cluster with Vector Search index support
* Groq API Key
* HuggingFace API Key
## Getting Started
### Backend Setup
1. Navigate to the backend directory:
   ```bash
   cd rag-backend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file in `rag-backend/`:
   ```env
   PORT=5000
   MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.abcde.mongodb.net/rag_db
   JWT_SECRET=your_jwt_secret_key_here
   GROQ_API_KEY=gsk_your_groq_api_key_here
   HUGGINGFACE_API_KEY=hf_your_huggingface_api_key_here
   RAG_MIN_RELEVANCE_SCORE=0.20
   ```
4. Start the backend service:
   ```bash
   npm start
   ```
### Frontend Setup
1. Navigate to the frontend directory:
   ```bash
   cd rag-assistant
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```
4. Open your browser at `http://localhost:5173`.

---

## Core Architecture and Features
### 1. Autonomous ReAct Agent Loop
* Implements the ReAct (Reason, Act, Observe, Repeat) execution pattern for deep document reasoning.
* Multi-Step Tool Execution:
  * `document_search`: Retrieves relevant document context from the user's uploaded files.
  * `list_user_documents`: Queries the user's document catalog to identify available files.
  * `calculate`: Evaluates mathematical expressions with strict safety checks.
* Multi-Topic Search Synthesis: Automatically coordinates multiple document queries for cross-domain questions before synthesizing the final answer.
* Strict Anti-Hallucination: Strictly enforces factual grounding in retrieved chunks. When queries fall outside uploaded files, the agent returns a clean refusal rather than fabricating data.
### 2. Hybrid Retrieval with Reciprocal Rank Fusion (RRF)
* Dense Semantic Vector Search: Powered by MongoDB Atlas Native Vector Search (`$vectorSearch`) with `BAAI/bge-small-en-v1.5` embeddings via HuggingFace Inference.
* Sparse Full-Text Search: Database-native MongoDB `$text` search index with BM25 textScore ranking.
* Reciprocal Rank Fusion (RRF): Combines dense and sparse results using rank-based weighting (k=60) for optimal retrieval accuracy without static stop-word dictionaries or brittle regex rules.
### 3. Factual Grounding and Citation Verification
* Multi-Document Relevance Filter: Evaluates vocabulary overlap, consecutive phrase matches, and document name mentions against generated responses.
* Dynamic Relative Thresholding: Automatically retains only documents that achieve significant overlap (at least 45% of top match score), preventing false positives and unrelated document citations.
* Guaranteed Source Display: Retains and displays exact document sources for relevant queries while rejecting unrelated noise.
### 4. Real-Time Word-by-Word Streaming
* Server-Sent Events (SSE) via `/api/chat/query-stream`.
* Words are streamed to the browser with paced intervals (25ms per token), delivering a smooth typewriter rendering effect.
* Streams intermediate agent reasoning steps directly to the frontend before outputting final answers.
* Supports client-side request cancellation and stream aborts.
### 5. Multi-Format Document Ingestion and OCR
* Ingests PDF documents (`pdf2json`), Microsoft Word documents (`mammoth`), and scanned image documents (`tesseract.js` OCR).
* Text Sanitization Pipeline: Strips OCR noise glyphs, broken table borders, and split-character OCR fragments while preserving structured data rows, code blocks, and numbers.
* Context-Aware Chunking: Automatically chunks text with configured token overlap to maintain cross-boundary context.
### 6. User Experience and Session Management
* Multi-Session Chat: Create, rename, view, and delete distinct chat sessions with persistent MongoDB storage.
* Contextual Chat History: Automatically maintains recent conversation context for follow-up questions.
* Chat Export: Export conversation threads directly as Markdown or JSON.
* Document Library Management: View, search, and delete uploaded files with instant vector cleanup.
## API Reference
### Authentication (`/api/auth`)
* `POST /api/auth/signup` - Register a new account (name, email, password).
* `POST /api/auth/login` - Authenticate with email and password to receive a JWT token.
* `GET /api/auth/me` - Fetch authenticated user profile.
### Document Management (`/api/documents` and `/api/docs`)
* `POST /api/documents/upload` - Upload and process a document (PDF, DOCX, image). Enforces a 10MB limit and rate limiting.
* `GET /api/documents` - List all uploaded documents for the current user.
* `DELETE /api/documents/:id` - Delete a document along with all its indexed vector chunks.
### Chat and AI Agent (`/api/chat`)
* `POST /api/chat/query-stream` - Stream answers word-by-word with live ReAct agent steps and grounded source citations.
* `POST /api/chat/query` - Standard non-streaming Q&A endpoint.
* `GET /api/chat/sessions` - Retrieve all conversation threads for the user.
* `GET /api/chat/:chatId/messages` - Retrieve message history for a specific conversation.
* `POST /api/chat/new` - Initialize a new conversation thread.
* `DELETE /api/chat/:chatId` - Delete a conversation session and all its messages.
### System Health
* `GET /api/health` - Health check endpoint verifying backend availability.
* `GET /` - Root status endpoint.
## Technology Stack
### Frontend
* React 19
* Vite
* TailwindCSS
* Lucide React Icons
### Backend
* Node.js (ES Modules)
* Express.js
* MongoDB Atlas and Mongoose
* Groq SDK (`openai/gpt-oss-120b`, If primary model is    unavailable :`openai/gpt-oss-20b`,`qwen/qwen3.8-27b`)
* HuggingFace Inference API (`BAAI/bge-small-en-v1.5`)
* Parsers: `pdf2json`, `mammoth`, `tesseract.js`
* Security: `bcryptjs`, `jsonwebtoken`, `express-rate-limit`, `cors`
## Data Models
1. **User**: Stores authentication credentials with hashed passwords and profile data.
2. **Document**: Stores document metadata, file sizes, mime types, and extraction statuses.
3. **Chunk**: Stores extracted text chunks, vector embeddings, page numbers, chunk indices, and compound text search indexes scoped by user ID.
4. **Chat**: Stores chat session metadata, titles, and ownership.
5. **Message**: Stores individual conversation turns, roles (`user`, `assistant`), generated responses, and grounded source citations.
## Security and Privacy
* Multi-Tenant Isolation: Every vector search, full-text search, and document query is strictly scoped to the authenticated `userId`.
* Password Security: Passwords are salted and hashed with `bcryptjs`.
* Stateless Sessions: Authenticated with JSON Web Tokens (7-day validity).
* Sensitive Data Redaction: Masks API keys, authorization tokens, card numbers, and credentials before saving or streaming.
* Abuse Prevention: Rate limiting is enforced on authentication, document uploads, and AI chat endpoints.

## Project Structure

```
rag-assistant-starter/
├── README.md
├── rag-assistant/               # Frontend Application
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── api/                 # Axios configuration and API clients
│       ├── components/          # Reusable UI components
│       ├── pages/               # Login, Signup, and Chat views
│       ├── App.jsx
│       └── main.jsx
└── rag-backend/                 # Backend Application
    ├── package.json
    ├── Server.js                # Server entry point
    ├── config/                  # Database connection setup
    ├── middleware/              # Auth and upload middleware
    ├── models/                  # Mongoose data schemas (User, Document, Chunk, Chat, Message)
    ├── routes/                  # API routes (auth, documents, chat)
    └── services/
        ├── embeddings.js        # HuggingFace vector embedding generation
        ├── groq.js              # Groq chat completion client
        ├── textSanitizer.js     # Text normalization and OCR cleaning
        └── agent/
            ├── agentRunner.js   # ReAct autonomous loop and grounding filter
            └── tools.js         # Document search, document catalog, calculator
```

## License
ISC