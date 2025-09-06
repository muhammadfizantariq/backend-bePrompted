import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import User from '../models/User.js';
import { sendVerificationEmail, sendPasswordResetEmail } from '../email.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const client = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

function signToken(user) {
  return jwt.sign({ id: user._id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function generateTokenPair() {}

function randomToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function register(req, res) {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ error: 'User already exists' });

    const passwordHash = await bcrypt.hash(password, 10);
    const tokenPlain = randomToken();
    const verificationTokenHash = hashToken(tokenPlain);
    const verificationExpires = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24h

  const isFirstAdminEmail = process.env.ADMIN_EMAIL && process.env.ADMIN_EMAIL.toLowerCase() === email.toLowerCase();
  const role = isFirstAdminEmail ? 'admin' : 'user';
  const user = await User.create({ email, passwordHash, verificationTokenHash, verificationExpires, verified: false, role });
    try { await sendVerificationEmail(email, tokenPlain); } catch (e) { console.warn('Failed to send verification email:', e.message); }
    res.status(201).json({ message: 'Registered. Please verify your email.' });
  } catch (err) {
    console.error('Register error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function verifyEmail(req, res) {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token required' });
    const hashed = hashToken(token);
    const user = await User.findOne({ verificationTokenHash: hashed, verificationExpires: { $gt: new Date() } });
    if (!user) return res.status(400).json({ error: 'Invalid or expired token' });
    user.verified = true;
    user.verificationTokenHash = undefined;
    user.verificationExpires = undefined;
    await user.save();
    const jwtToken = signToken(user);
  res.json({ token: jwtToken, user: { email: user.email, verified: true, role: user.role } });
  } catch (err) {
    console.error('Verify email error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function resendVerification(req, res) {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.verified) return res.status(400).json({ error: 'Already verified' });
    const tokenPlain = randomToken();
    user.verificationTokenHash = hashToken(tokenPlain);
    user.verificationExpires = new Date(Date.now() + 1000 * 60 * 60 * 24);
    await user.save();
    try { await sendVerificationEmail(email, tokenPlain); } catch (e) { console.warn('Failed to send verification email:', e.message); }
    res.json({ message: 'Verification email sent' });
  } catch (err) {
    console.error('Resend verification error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function login(req, res) {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (user.provider !== 'local') return res.status(400).json({ error: 'Use social login' });
    const valid = await bcrypt.compare(password, user.passwordHash || '');
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    if (!user.verified) return res.status(403).json({ error: 'Email not verified' });
    const token = signToken(user);
  res.json({ token, user: { email: user.email, verified: user.verified, role: user.role } });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function forgotPassword(req, res) {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const user = await User.findOne({ email });
    if (!user) return res.json({ message: 'If account exists, email sent' });
    const tokenPlain = randomToken();
    user.resetTokenHash = hashToken(tokenPlain);
    user.resetExpires = new Date(Date.now() + 1000 * 60 * 30); // 30m
    await user.save();
    try { await sendPasswordResetEmail(email, tokenPlain); } catch (e) { console.warn('Failed to send reset email:', e.message); }
    res.json({ message: 'If account exists, email sent' });
  } catch (err) {
    console.error('Forgot password error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function resetPassword(req, res) {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and password required' });
    const hashed = hashToken(token);
    const user = await User.findOne({ resetTokenHash: hashed, resetExpires: { $gt: new Date() } });
    if (!user) return res.status(400).json({ error: 'Invalid or expired token' });
    if (password.length < 6) return res.status(400).json({ error: 'Password too short' });
    user.passwordHash = await bcrypt.hash(password, 10);
    user.resetTokenHash = undefined;
    user.resetExpires = undefined;
    await user.save();
    res.json({ message: 'Password reset successful' });
  } catch (err) {
    console.error('Reset password error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function googleAuth(req, res) {
  try {
    const { idToken } = req.body;
    if (!GOOGLE_CLIENT_ID) return res.status(500).json({ error: 'Google auth not configured' });
    if (!idToken) return res.status(400).json({ error: 'idToken required' });
    const ticket = await client.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const email = payload.email;
    let user = await User.findOne({ email });
    if (!user) {
      user = await User.create({ email, verified: true, provider: 'google', googleId: payload.sub });
    } else if (user.provider !== 'google') {
      return res.status(400).json({ error: 'Account exists with different sign-in method' });
    }
    const token = signToken(user);
  res.json({ token, user: { email: user.email, verified: user.verified, provider: user.provider, role: user.role } });
  } catch (err) {
    console.error('Google auth error:', err.message);
    res.status(500).json({ error: 'Google authentication failed' });
  }
}

export async function me(req, res) { res.json({ user: req.user }); }

// Middleware factory for role protection (usage: app.get('/admin', requireRole('admin'), handler))
export function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}
