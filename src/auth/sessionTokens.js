const { createHmac, timingSafeEqual } = require('node:crypto');
const jwt = require('jsonwebtoken');

const JWT_ISSUER = 'job-tracker-api';
const JWT_AUDIENCE = 'job-tracker-web';

function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32) {
    const error = new Error('Authentication is not configured.');
    error.status = 503;
    throw error;
  }
  return secret;
}

function accessCookieName() {
  return process.env.NODE_ENV === 'production' ? '__Host-jobtrack_access' : 'jobtrack_access';
}

function signAccessToken(userId, sessionId, expiresIn = 15 * 60) {
  return jwt.sign(
    { sid: String(sessionId) },
    jwtSecret(),
    {
      algorithm: 'HS256',
      audience: JWT_AUDIENCE,
      issuer: JWT_ISSUER,
      subject: String(userId),
      expiresIn,
    },
  );
}

function refreshCookieName() {
  return process.env.NODE_ENV === 'production' ? '__Host-jobtrack_refresh' : 'jobtrack_refresh';
}

function readCookie(request, name) {
  const prefix = `${name}=`;
  const item = (request.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix));
  if (!item) return null;
  try {
    return decodeURIComponent(item.slice(prefix.length));
  } catch {
    return null;
  }
}

function verifyAccessToken(request) {
  const token = readCookie(request, accessCookieName());
  if (!token) return null;

  try {
    return jwt.verify(token, jwtSecret(), {
      algorithms: ['HS256'],
      audience: JWT_AUDIENCE,
      issuer: JWT_ISSUER,
    });
  } catch (error) {
    if (error.status === 503) throw error;
    return null;
  }
}

function createCsrfToken(sessionId) {
  return createHmac('sha256', jwtSecret()).update(`job-tracker-csrf-v1:${sessionId}`).digest('base64url');
}

function validCsrfToken(request, sessionId) {
  const supplied = request.get('x-csrf-token');
  if (typeof supplied !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(supplied)) return false;
  const expected = createCsrfToken(sessionId);
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

module.exports = {
  accessCookieName,
  createCsrfToken,
  jwtSecret,
  readCookie,
  refreshCookieName,
  signAccessToken,
  validCsrfToken,
  verifyAccessToken,
};
