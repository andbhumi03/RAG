# RAG Assistant Starter (AI-Powered Document Analysis & Chat)

**RAG Assistant** is an intelligent, enterprise-ready backend service built with Node.js and MongoDB, designed for seamless PDF extraction, vectorization, and AI-powered chat capabilities. This starter template provides a robust foundation for building applications that require secure user authentication, document management, and semantic search.

## 🚀 Quick Start

### Prerequisites
*   **Node.js** (v18 or higher)
*   **MongoDB** (Local or MongoDB Atlas)

### Setup
1.  Navigate to the backend directory:
    ```bash
    cd rag-backend
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Create a `.env` file in the `rag-backend` directory with your MongoDB URI:
    ```bash
    # Example .env content
    MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.abcde.mongodb.net/rag_db
    JWT_SECRET=your_secret_key_here
    PORT=5000
    ```
4.  Start the server:
    ```bash
    npm start
    ```

## 🔌 API Endpoints

The backend exposes the following RESTful APIs:

### 🔐 Authentication
-   `POST /api/auth/signup` - Register a new user.
-   `POST /api/auth/login` - Login with email and password.
-   `GET /api/auth/me` - Get current logged-in user details.

### 📚 Document Management
-   `POST /api/documents/upload` - Upload a PDF/image file. The file is processed, vectorized, and saved to MongoDB.
    - *Security*: Enforces a **10MB file size limit** and uses **rate limiting** to prevent abuse.
-   `GET /api/documents` - Get all documents uploaded by the user.
-   `DELETE /api/documents/:id` - Delete a document and its associated vector data.

### 🤖 Smart Assistant (RAG)
-   `POST /api/chat` - Ask a question about your documents. The system performs semantic search and uses **OpenAI** to generate a context-aware answer.
    - **Smart Chunking**: Automatically splits large PDFs into semantically meaningful chunks using RecursiveTextSplitter.
    - **Hybrid Retrieval**: Combines **Keyword Search** (TF-IDF) and **Vector Search** (Cosine Similarity) for accurate results.
    - **Rate Limiting**: Protects the AI service from excessive requests.

### ⚙️ Utilities
-   `GET /api/health` - Health check endpoint.
-   `GET /` - Welcome message for the API.

## 🛠️ Technology Stack

*   **Framework**: [Express.js](https://expressjs.com/)
*   **Database**: [MongoDB](https://www.mongodb.com/)
*   **Object Modeling**: [Mongoose](https://mongoosejs.com/)
*   **Authentication**: [JWT (jsonwebtoken)](https://www.npmjs.com/package/jsonwebtoken)
*   **Vectorization**: [OpenAI Embeddings](https://openai.com/index/embedding-models/)
*   **PDF Processing**: `pdf-parse` and `pdf2json`
*   **Text Processing**: `@langchain/text-splitters`
*   **Security**: `bcryptjs`, `express-rate-limit`, `cors`

## 💾 Data Models

The backend uses the following Mongoose schemas:

1.  **User**: Stores user credentials and profile information.
2.  **Document**: Stores metadata about uploaded files, including file name, vector embedding status, and file size.
3.  **Chunk**: Stores processed text chunks from documents, used for vector storage and retrieval.
4.  **Chat**: Stores conversation history (user questions and AI answers) for maintaining chat context.

## 🛡️ Security Features
*   **Password Hashing**: Uses `bcryptjs` to securely hash and compare passwords.
*   **JWT Authentication**: Stateless authentication using JSON Web Tokens.
*   **Rate Limiting**: Prevents brute-force attacks and API abuse.
*   **Input Validation**: Validates file types and sizes to prevent malicious uploads.

## 🎯 Key Features
1.  **File Upload System**: Robust handling of PDF and image file uploads.
2.  **Smart Document Processing**: Automatic chunking and vectorization of uploaded documents.
3.  **AI-Powered Chat**: Intelligent Q&A system using OpenAI's GPT models.
4.  **Contextual Search**: Hybrid retrieval mechanism combining keyword and vector search.
5.  **Conversation History**: Chat model that remembers previous messages for better context.
6.  **User Management**: Secure signup, login, and session management.

## 📂 Project Structure

```
rag-backend/
├── models/
│   ├── User.js          # User schema
│   ├── Document.js      # Document schema
│   ├── Chunk.js         # Text chunk schema
│   └── Chat.js          # Chat history schema
├── routes/
│   ├── auth.js          # Authentication routes
│   ├── docRoutes.js     # Document upload and management routes
│   ├── Documents.js     # Document CRUD routes
│   └── chat.js          # Chat/AI assistant routes
├── .env                 # Environment variables (not in git)
├── package.json         # Project dependencies
└── Server.js            # Main application entry point
```

## 📝 Usage

1.  Start the server: `npm start`
2.  Upload a document via the `/api/documents/upload` endpoint.
3.  Ask questions using the `/api/chat` endpoint.
4.  Manage your documents with the `/api/documents` endpoints.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

ISC