import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { collection } from '../config/database.js';
import { sendPasswordResetEmail } from '../services/documents.js';

const router = express.Router();

const normalizeLoginValue = (value) => String(value ?? '').trim().toLowerCase();

const generateToken = (user) => jwt.sign(
  { id: user.id, email: user.email, name: user.name, role: user.role || 'user' },
  process.env.JWT_SECRET || 'ranniti-dev-secret',
  { expiresIn: '7d' }
);

router.post('/register', async (req, res) => {
  const { name, email, password, username } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({
      success: false,
      message: 'Name, email, and password are required',
    });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const normalizedName = String(name).trim();
  const normalizedUsername = normalizeLoginValue(username || normalizedName);

  if (!normalizedName || !normalizedEmail || !String(password).trim()) {
    return res.status(400).json({
      success: false,
      message: 'Invalid user details provided',
    });
  }

  const users = await collection('users');
  const existingUser = await users.findOne({ $or: [{ email: normalizedEmail }, { username: normalizedUsername }] });

  if (existingUser) {
    return res.status(409).json({
      success: false,
      message: 'User already exists',
    });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const createdAt = new Date().toISOString();
  const userId = uuidv4();

  const role = process.env.ADMIN_EMAIL && normalizedEmail === process.env.ADMIN_EMAIL.trim().toLowerCase() ? 'admin' : 'user';

  await users.insertOne({ id: userId, name: normalizedName, username: normalizedUsername, email: normalizedEmail, password_hash: passwordHash, role, created_at: createdAt, updated_at: createdAt });

  const user = {
    id: userId,
    name: normalizedName,
    email: normalizedEmail,
    role,
    createdAt,
    updatedAt: createdAt,
  };

  return res.status(201).json({
    success: true,
    message: 'User registered successfully',
    user,
    token: generateToken(user),
  });
});

router.post('/forgot-password', async (req, res) => {
  const normalizedEmail = String(req.body?.email || '').trim().toLowerCase();
  const genericResponse = { success: true, message: 'If an account exists, a password reset link has been sent.' };
  if (!normalizedEmail) return res.json(genericResponse);
  const users = await collection('users');
  const user = await users.findOne({ email: normalizedEmail });
  if (!user) return res.json(genericResponse);
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  await users.updateOne({ _id: user._id }, { $set: { reset_token_hash: tokenHash, reset_token_expires_at: expiresAt } });
  try {
    const forwardedProto = String(req.get('x-forwarded-proto') || 'https').split(',')[0];
    const forwardedHost = req.get('x-forwarded-host') || req.get('host');
    const requestUrl = forwardedHost ? `${forwardedProto}://${forwardedHost}` : '';
    await sendPasswordResetEmail(user, token, process.env.APP_URL || req.get('origin') || requestUrl || `http://localhost:${process.env.PORT || 5000}`);
  } catch (error) {
    await users.updateOne({ _id: user._id }, { $unset: { reset_token_hash: '', reset_token_expires_at: '' } });
    return res.status(502).json({ success: false, message: error.message });
  }
  return res.json(genericResponse);
});

router.post('/reset-password', async (req, res) => {
  const token = String(req.body?.token || '');
  const password = String(req.body?.password || '');  
  if (password.length < 8) return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const users = await collection('users');
  const user = await users.findOne({ reset_token_hash: tokenHash, reset_token_expires_at: { $gt: new Date().toISOString() } });
  if (!user) return res.status(400).json({ success: false, message: 'This reset link is invalid or expired.' });
  await users.updateOne({ _id: user._id }, { $set: { password_hash: await bcrypt.hash(password, 12), updated_at: new Date().toISOString() }, $unset: { reset_token_hash: '', reset_token_expires_at: '' } });
  return res.json({ success: true, message: 'Password updated. You can sign in now.' });
});

router.post('/login', async (req, res) => {
  const loginValue = normalizeLoginValue(req.body?.email ?? req.body?.username);
  const password = String(req.body?.password ?? '');

  if (!loginValue || !password) {
    return res.status(400).json({
      success: false,
      message: 'Email or username and password are required',
    });
  }

  const normalizedLogin = normalizeLoginValue(loginValue);
  const users = await collection('users');
  const escapedLogin = normalizedLogin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const user = await users.findOne({
    $or: [
      { email: normalizedLogin },
      { username: normalizedLogin },
      { email: { $regex: `^${escapedLogin}$`, $options: 'i' } },
      { name: { $regex: `^${escapedLogin}$`, $options: 'i' } },
    ],
  });

  if (!user || !user.password_hash) {
    return res.status(401).json({
      success: false,
      message: user ? 'This account has no password yet. Register with the same email to set one.' : 'Invalid email or password',
    });
  }

  const isValidPassword = await bcrypt.compare(password, user.password_hash);

  if (!isValidPassword) {
    return res.status(401).json({
      success: false,
      message: 'Invalid email or password',
    });
  }

  const safeUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };

  return res.json({
    success: true,
    message: 'Login successful',
    user: safeUser,
    token: generateToken(safeUser),
  });
});

router.post('/logout', (req, res) => {
  res.json({
    success: true,
    message: 'Logout successful',
  });
});

export default router;
