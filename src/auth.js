const crypto = require('node:crypto');
const express = require('express');
const mongoose = require('mongoose');

const router = express.Router();
const SESSION_HOURS = 12;
const COOKIE_NAME = 'jobtracker_session';
const attempts = new Map();
const sessionSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: true });
const Session = mongoose.models.JobTrackerSession || mongoose.model('JobTrackerSession', sessionSchema);

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api',
  };
}

function requireSameOrigin(request, response, next) {
  const allowed = allowedOrigins();
  if (!request.get('origin') || !allowed.includes(request.get('origin'))) {
    return response.status(403).json({ message: 'Request origin is not allowed.' });
  }
  return next();
}

function allowedOrigins() {
  return (process.env.FRONTEND_ORIGIN || 'http://localhost:3000')
    .split(',').map((origin) => origin.trim()).filter(Boolean);
}

function requireTrustedOrigin(request, response, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return next();
  return requireSameOrigin(request, response, next);
}

function rateLimitLogin(request, response, next) {
  const now = Date.now();
  const key = request.ip;
  const current = attempts.get(key) || { count: 0, resetAt: now + 15 * 60 * 1000 };
  if (current.resetAt <= now) {
    current.count = 0;
    current.resetAt = now + 15 * 60 * 1000;
  }
  if (current.count >= 5) {
    response.set('Retry-After', String(Math.ceil((current.resetAt - now) / 1000)));
    return response.status(429).json({ message: 'Too many login attempts. Try again later.' });
  }
  current.count += 1;
  attempts.set(key, current);
  if (attempts.size > 10000) {
    for (const [address, attempt] of attempts) {
      if (attempt.resetAt <= now) attempts.delete(address);
    }
  }
  return next();
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function sessionCookie(request) {
  const prefix = `${COOKIE_NAME}=`;
  const entry = (request.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : '';
}

router.post('/login', requireSameOrigin, rateLimitLogin, async (request, response, next) => {
  try {
    const expected = process.env.ADMIN_PASSWORD;
    const provided = request.body?.password;
    if (!expected || typeof provided !== 'string') {
      return response.status(401).json({ message: 'Invalid password.' });
    }
    const expectedBuffer = Buffer.from(expected);
    const providedBuffer = Buffer.from(provided);
    const matches = expectedBuffer.length === providedBuffer.length
      && crypto.timingSafeEqual(expectedBuffer, providedBuffer);
    if (!matches) return response.status(401).json({ message: 'Invalid password.' });

    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
    await Session.create({ tokenHash: tokenHash(token), expiresAt });
    response.cookie(COOKIE_NAME, token, { ...cookieOptions(), maxAge: SESSION_HOURS * 60 * 60 * 1000 });
    return response.json({ authenticated: true });
  } catch (error) {
    return next(error);
  }
});

async function requireAuth(request, response, next) {
  try {
    const token = sessionCookie(request);
    if (!token) return response.status(401).json({ message: 'Authentication required.' });
    const session = await Session.findOne({ tokenHash: tokenHash(token), expiresAt: { $gt: new Date() } }).lean();
    if (!session) return response.status(401).json({ message: 'Authentication required.' });
    request.sessionId = session._id;
    return next();
  } catch (error) {
    return next(error);
  }
}

router.get('/session', requireAuth, (request, response) => response.json({ authenticated: true }));
router.post('/logout', requireSameOrigin, async (request, response, next) => {
  try {
    const token = sessionCookie(request);
    if (token) await Session.deleteOne({ tokenHash: tokenHash(token) });
    response.clearCookie(COOKIE_NAME, cookieOptions());
    return response.json({ authenticated: false });
  } catch (error) {
    return next(error);
  }
});

module.exports = { authRouter: router, requireAuth, requireTrustedOrigin };
