import mongoose from 'mongoose';

const chunkSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true, index: true },
  chunkText: { type: String, required: true },
  pageNumber: { type: Number, default: null },
  chunkIndex: { type: Number, default: 0 },
  embedding: { type: [Number], default: [] },
});

// User-isolated compound indexes for high-speed retrieval & native text search
chunkSchema.index({ userId: 1, documentId: 1 });
chunkSchema.index({ userId: 1, chunkIndex: 1 });
chunkSchema.index({ userId: 1, chunkText: 'text' });

export default mongoose.model('Chunk', chunkSchema);