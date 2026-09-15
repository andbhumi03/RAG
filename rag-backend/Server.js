import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit'; // <--- 1. Import Rate Limiter

import authRoutes from './routes/auth.js';
import documentRoutes from './routes/Documents.js';
import chatRoutes from './routes/chat.js';

const app = express();

// Rate Limiter Setup (Brute force protection)
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 Minutes
    max: 100, // Max 100 requests per IP
    message: { error: 'Too many requests, please try again later.' },
});

app.use(cors());
app.use(express.json());
app.use('/api/', apiLimiter); // <--- 2. Apply Rate Limiter to API routes

// Main Registered Routes
app.use('/api/auth', authRoutes);
app.use('/api/docs', documentRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/chat', chatRoutes);

// Custom Clean Error Handler for Multer & Server Errors
app.use((err, req, res, next) => {
    // <--- 3. Clean JSON Error Handler
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
            error: 'File size too large. Maximum allowed size is 10MB.',
        });
    }
    return res
        .status(500)
        .json({ error: err.message || 'Internal Server Error' });
});

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGODB_URI;

if (!MONGO_URI) {
    console.error('⚠️ Error: MONGODB_URI environment variable missing.');
} else {
    mongoose
        .connect(MONGO_URI, { family: 4 })
        .then(() => console.log('Connected to MongoDB Atlas successfully!'))
        .catch((err) =>
            console.error('MongoDB connection error:', err.message)
        );

    app.get('/', (req, res) => {
        res.send('RAG Backend API is running!');
    });

    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}
