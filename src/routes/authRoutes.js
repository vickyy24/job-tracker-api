const { createHash, randomBytes } = require('node:crypto');
const express = require('express');
const AuthSession = require('../models/AuthSession');
const User = require('../models/User');
const { hashPassword, isValidEmail, normalizeEmail, validatePassword, verifyPassword } = require('../auth/credentials');
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
    maxAge,
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

async function createSession(user, response) {
  const refreshToken = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
  const session = await AuthSession.create({
    userId: user._id,
    refreshTokenHash: tokenHash(refreshToken),
    expiresAt,
  });

  response.cookie(accessCookieName(), signAccessToken(user._id, session._id, ACCESS_TTL_SECONDS), cookieOptions(ACCESS_TTL_SECONDS * 1000));
  response.cookie(refreshCookieName(), refreshToken, cookieOptions(REFRESH_TTL_MS));
  return {
    user: { id: String(user._id), email: user.email },
    csrfToken: createCsrfToken(session._id),
  };
}

function credentialsFrom(request) {
  if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) return null;
  const email = normalizeEmail(request.body.email);
  const { password } = request.body;
  if (!isValidEmail(email) || typeof password !== 'string') return null;
  return { email, password };
}

router.post('/register', async (request, response) => {
  const credentials = credentialsFrom(request);
  if (!credentials) return response.status(400).json({ message: 'Enter a valid email and password.' });

  const passwordError = validatePassword(credentials.password);
  if (passwordError) return response.status(400).json({ message: passwordError });

  let user;
  try {
    user = await User.create({ email: credentials.email, passwordHash: await hashPassword(credentials.password) });
  } catch (error) {
    if (error.code === 11000) {
      return response.status(409).json({ message: 'Unable to create an account with those details.' });
    }
    throw error;
  }

  const session = await createSession(user, response);
  return response.status(201).json(session);
});

router.post('/login', async (request, response) => {
  const credentials = credentialsFrom(request);
  if (!credentials || validatePassword(credentials.password)) {
    return response.status(401).json({ message: 'Email or password is incorrect.' });
  }

  const user = await User.findOne({ email: credentials.email }).select('+passwordHash');
  if (!user || !(await verifyPassword(credentials.password, user.passwordHash))) {
    return response.status(401).json({ message: 'Email or password is incorrect.' });
  }

  return response.json(await createSession(user, response));
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

  const user = await User.findById(claims.sub).select('_id email');
  if (!user) return response.status(401).json({ message: 'Authentication required.' });
  return response.json({ user: { id: String(user._id), email: user.email }, csrfToken: createCsrfToken(claims.sid) });
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
  }, { new: true });

  if (!rotatedSession) {
    clearSessionCookies(response);
    return response.status(401).json({ message: 'Authentication required.' });
  }

  const user = await User.findById(rotatedSession.userId).select('_id email');
  if (!user) {
    await AuthSession.updateOne({ _id: rotatedSession._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
    clearSessionCookies(response);
    return response.status(401).json({ message: 'Authentication required.' });
  }

  response.cookie(accessCookieName(), signAccessToken(user._id, rotatedSession._id, ACCESS_TTL_SECONDS), cookieOptions(ACCESS_TTL_SECONDS * 1000));
  response.cookie(refreshCookieName(), refreshToken, cookieOptions(REFRESH_TTL_MS));
  return response.json({ user: { id: String(user._id), email: user.email }, csrfToken: createCsrfToken(rotatedSession._id) });
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
