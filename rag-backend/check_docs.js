import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Document from './models/Document.js';

dotenv.config();

mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    const docs = await Document.find({});
    console.log(JSON.stringify(docs, null, 2));
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
