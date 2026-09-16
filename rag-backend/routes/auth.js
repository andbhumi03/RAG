import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import User from '../models/User.js';
import { authenticateToken } from '../middleware/auth.js';
const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'my_super_secret_key_for_college_project_2026';
function databaseUnavailable(res) {
  if (mongoose.connection.readyState === 1) return false;
  res.status(503).json({
    error: 'Database unavailable',
    details: 'MongoDB is not connected. Add this machine IP to the MongoDB Atlas access list and verify MONGODB_URI.',
  });
  return true;
}
// GET /api/auth/me (Verify session)
router.get('/me', authenticateToken, async (req, res) => {
  try {
    if (databaseUnavailable(res)) return;
    const user = await User.findById(req.user.userId).select('-passwordHash -password');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user: { id: user._id, name: user.name, email: user.email } });
  } catch (error) {
    console.error('Session verification error:', error);
    res.status(500).json({ error: 'Failed to verify session', details: error.message });
  }
});
// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  try {
    if (databaseUnavailable(res)) return;
    const { name, email, password } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }
   const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    // Save passwordHash directly
    const user = await User.create({ 
      name, 
      email: email.toLowerCase().trim(), 
      passwordHash 
    });
    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ 
      token, 
      user: { id: user._id, name: user.name, email: user.email } 
    });
  } catch (error) {
    console.error('DETAILED SIGNUP ERROR:', error); // Check backend terminal for full error
    res.status(500).json({ error: 'Signup failed', details: error.message });
  }
});
// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    if (databaseUnavailable(res)) return;
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    // Support schema variations (passwordHash vs password)
    const storedHash = user.passwordHash || user.password;
    if (!storedHash) {
      console.error(`User record ${user._id} has no hashed password stored.`);
      return res.status(500).json({ error: 'Account configuration error. Please contact admin.' });
    }
    const isMatch = await bcrypt.compare(password, storedHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ 
      token, 
      user: { id: user._id, name: user.name, email: user.email } 
    });
  } catch (error) {
    console.error('DETAILED LOGIN ERROR:', error); // Check backend terminal for full error
    res.status(500).json({ error: 'Login failed', details: error.message });
  }
});
export default router;