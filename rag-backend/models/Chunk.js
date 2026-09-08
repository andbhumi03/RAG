import mongoose from 'mongoose';

const chunkSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true },
  chunkText: { type: String, required: true },
  pageNumber: { type: Number, default: null },
  embedding: { type: [Number], default: [] }, // will be filled in next step
});

export default mongoose.model('Chunk', chunkSchema);