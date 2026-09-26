import mongoose from 'mongoose';

const documentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  fileName: { type: String, required: true },
  uploadDate: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
  chunkCount: { type: Number, default: 0 },
  status: { type: String, default: 'processed' },
});

// Cascade delete: automatically delete associated chunks when a document is deleted
documentSchema.pre('findOneAndDelete', async function () {
  const doc = await this.model.findOne(this.getQuery());
  if (doc) {
    await mongoose.model('Chunk').deleteMany({ documentId: doc._id });
  }
});

documentSchema.pre('deleteOne', { document: true, query: false }, async function () {
  await mongoose.model('Chunk').deleteMany({ documentId: this._id });
});

documentSchema.pre('deleteMany', async function () {
  const docs = await this.model.find(this.getQuery()).select('_id');
  const ids = docs.map(d => d._id);
  if (ids.length > 0) {
    await mongoose.model('Chunk').deleteMany({ documentId: { $in: ids } });
  }
});

export default mongoose.model('Document', documentSchema);