import mongoose from 'mongoose';

const documentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  fileName: { type: String, required: true },
  uploadDate: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
  chunkCount: { type: Number, default: 0 },
  status: { type: String, default: 'processed' },
});

export default mongoose.model('Document', documentSchema);