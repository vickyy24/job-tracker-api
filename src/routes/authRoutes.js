const { createHash, createHmac, randomBytes } = require('node:crypto');
const express = require('express');
const AuthRateLimit = require('../models/AuthRateLimit');
const AuthSession = require('../models/AuthSession');
const User = require('../models/User');
const { hashPassword, normalizeUsername, isValidUsername, validatePassword, verifyPassword } = require('../auth/credentials');
const { requireTrustedOrigin } = require('../auth');
const {
  accessCookieName,
  createCsrfToken,
  readCookie,
  refreshCookieName,
  signAccessToken,
  validCsrfToken,
  verifyAccessToken,
} = require('../auth/sessionTokens');

const router = express.Router();
const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const isProduction = () => process.env.NODE_ENV === 'production';

router.use(requireTrustedOrigin);

function cookieOptions(maxAge) {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    path: '/',
    ...(Number.isFinite(maxAge) ? { maxAge } : {}),
  };
}

function clearSessionCookies(response) {
  const options = cookieOptions(undefined);
  delete options.maxAge;
  response.clearCookie(accessCookieName(), options);
  response.clearCookie(refreshCookieName(), options);
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('base64url');
}

async function activeSessionFromRefreshCookie(request) {
  const token = readCookie(request, refreshCookieName());
  if (!token) return null;
  return AuthSession.findOne({
    refreshTokenHash: tokenHash(token),
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  }).select('+refreshTokenHash');
}

async function createSession(user, response, rememberMe = true) {
  const refreshToken = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
  const session = await AuthSession.create({
    userId: user._id,
    refreshTokenHash: tokenHash(refreshToken),
    expiresAt,
    rememberMe,
  });

  response.cookie(accessCookieName(), signAccessToken(user._id, session._id, ACCESS_TTL_SECONDS), cookieOptions(rememberMe ? ACCESS_TTL_SECONDS * 1000 : undefined));
  response.cookie(refreshCookieName(), refreshToken, cookieOptions(rememberMe ? REFRESH_TTL_MS : undefined));
  return {
    user: { id: String(user._id), username: user.username },
    csrfToken: createCsrfToken(session._id),
  };
}

function credentialsFrom(request) {
  if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) return null;
  const username = normalizeUsername(request.body.username);
  const { password } = request.body;
  if (!isValidUsername(username) || typeof password !== 'string') return null;
  return { username, password };
}

async function rateLimit(request, response, scope, limit, windowMs) {
  const secret = process.env.JWT_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    response.status(503).json({ message: 'Authentication is not configured.' });
    return false;
  }
  const ip = request.ip || request.socket.remoteAddress || 'unknown';
  const key = createHmac('sha256', secret).update(`auth-rate-v1:${scope}:${ip}`).digest('base64url');
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowMs);
  const counter = await AuthRateLimit.findOneAndUpdate({ key }, [{
    $set: {
      count: { $cond: [{ $gt: ['$resetAt', now] }, { $add: [{ $ifNull: ['$count', 0] }, 1] }, 1] },
      resetAt: { $cond: [{ $gt: ['$resetAt', now] }, '$resetAt', resetAt] },
    },
  }], { upsert: true, returnDocument: 'after', updatePipeline: true }).lean();

  if (counter.count <= limit) return true;
  response.set('Retry-After', String(Math.max(1, Math.ceil((new Date(counter.resetAt).getTime() - now.getTime()) / 1000))));
  response.status(429).json({ message: 'Too many attempts. Please wait and try again.' });
  return false;
}

router.post('/register', async (request, response) => {
  if (!(await rateLimit(request, response, 'register', 5, 60 * 60 * 1000))) return;
  const credentials = credentialsFrom(request);
  const confirmPassword = request.body?.confirmPassword;
  if (!credentials) {
    return response.status(400).json({ message: 'Use a username of 3–32 letters, numbers, dots, underscores, or hyphens.' });
  }
  if (credentials.password !== confirmPassword) {
    return response.status(400).json({ message: 'Passwords do not match.' });
  }
  const passwordError = validatePassword(credentials.password);
  if (passwordError) return response.status(400).json({ message: passwordError });

  let user;
  try {
    user = await User.create({ username: credentials.username, passwordHash: await hashPassword(credentials.password) });
  } catch (error) {
    if (error.code === 11000) return response.status(409).json({ message: 'That username is already taken.' });
    error.operation = 'auth.register.create-user';
    throw error;
  }

  try {
    return response.status(201).json(await createSession(user, response));
  } catch (error) {
    error.operation = 'auth.register.create-session';
    throw error;
  }
});

router.post('/login', async (request, response) => {
  if (!(await rateLimit(request, response, 'login', 10, 15 * 60 * 1000))) return;
  const credentials = credentialsFrom(request);
  if (!credentials || credentials.password.length === 0 || credentials.password.length > 128) {
    return response.status(401).json({ message: 'Username or password is incorrect.' });
  }

  const user = await User.findOne({ username: credentials.username }).select('+passwordHash');
  if (!user) {
    console.warn('[auth:login-failed]', { reason: 'account-not-found' });
    return response.status(401).json({ message: 'Username or password is incorrect.' });
  }
  if (!(await verifyPassword(credentials.password, user.passwordHash))) {
    console.warn('[auth:login-failed]', { reason: 'password-mismatch' });
    return response.status(401).json({ message: 'Username or password is incorrect.' });
  }

  try {
    return response.json(await createSession(user, response, request.body?.rememberMe !== false));
  } catch (error) {
    error.operation = 'auth.login.create-session';
    throw error;
  }
});

router.get('/csrf', async (request, response) => {
  const claims = verifyAccessToken(request);
  if (claims && typeof claims.sid === 'string' && typeof claims.sub === 'string') {
    const session = await AuthSession.exists({ _id: claims.sid, userId: claims.sub, revokedAt: null, expiresAt: { $gt: new Date() } });
    if (session) return response.json({ csrfToken: createCsrfToken(claims.sid) });
  }

  const session = await activeSessionFromRefreshCookie(request);
  if (!session) return response.status(401).json({ message: 'Authentication required.' });
  return response.json({ csrfToken: createCsrfToken(session._id) });
});

router.get('/session', async (request, response) => {
  const claims = verifyAccessToken(request);
  if (!claims || typeof claims.sid !== 'string' || typeof claims.sub !== 'string') {
    return response.status(401).json({ message: 'Authentication required.' });
  }

  const session = await AuthSession.exists({ _id: claims.sid, userId: claims.sub, revokedAt: null, expiresAt: { $gt: new Date() } });
  if (!session) return response.status(401).json({ message: 'Authentication required.' });

  const user = await User.findById(claims.sub).select('_id username');
  if (!user) return response.status(401).json({ message: 'Authentication required.' });
  return response.json({ user: { id: String(user._id), username: user.username }, csrfToken: createCsrfToken(claims.sid) });
});

router.post('/refresh', async (request, response) => {
  const session = await activeSessionFromRefreshCookie(request);
  if (!session) {
    clearSessionCookies(response);
    return response.status(401).json({ message: 'Authentication required.' });
  }
  if (!validCsrfToken(request, session._id)) return response.status(403).json({ message: 'Request verification failed.' });

  const refreshToken = randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + REFRESH_TTL_MS);
  const rotatedSession = await AuthSession.findOneAndUpdate({
    _id: session._id,
    refreshTokenHash: session.refreshTokenHash,
    revokedAt: null,
    expiresAt: { $gt: now },
  }, {
    $set: { refreshTokenHash: tokenHash(refreshToken), expiresAt },
  }, { returnDocument: 'after' });

  if (!rotatedSession) {
    clearSessionCookies(response);
    return response.status(401).json({ message: 'Authentication required.' });
  }

  const user = await User.findById(rotatedSession.userId).select('_id username');
  if (!user) {
    await AuthSession.updateOne({ _id: rotatedSession._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
    clearSessionCookies(response);
    return response.status(401).json({ message: 'Authentication required.' });
  }

  response.cookie(accessCookieName(), signAccessToken(user._id, rotatedSession._id, ACCESS_TTL_SECONDS), cookieOptions(rotatedSession.rememberMe ? ACCESS_TTL_SECONDS * 1000 : undefined));
  response.cookie(refreshCookieName(), refreshToken, cookieOptions(rotatedSession.rememberMe ? REFRESH_TTL_MS : undefined));
  return response.json({ user: { id: String(user._id), username: user.username }, csrfToken: createCsrfToken(rotatedSession._id) });
});

router.post('/logout', async (request, response) => {
  const session = await activeSessionFromRefreshCookie(request);
  if (session && !validCsrfToken(request, session._id)) {
    return response.status(403).json({ message: 'Request verification failed.' });
  }
  if (session) await AuthSession.updateOne({ _id: session._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
  clearSessionCookies(response);
  return response.status(204).end();
});

module.exports = router;
