const AuthSession = require('../models/AuthSession');
const User = require('../models/User');
const { validCsrfToken, verifyAccessToken } = require('./sessionTokens');

async function requireAuthenticatedUser(request, response, next) {
  const claims = verifyAccessToken(request);
  if (!claims || typeof claims.sub !== 'string' || typeof claims.sid !== 'string') {
    return response.status(401).json({ message: 'Authentication required.' });
  }

  const session = await AuthSession.findOne({
    _id: claims.sid,
    userId: claims.sub,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  }).select('_id userId').lean();

  if (!session) return response.status(401).json({ message: 'Authentication required.' });

  const user = await User.exists({ _id: session.userId });
  if (!user) return response.status(401).json({ message: 'Authentication required.' });

  request.user = { id: String(session.userId), sessionId: String(session._id) };
  return next();
}

function requireCsrfToken(request, response, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return next();
  if (!request.user || !validCsrfToken(request, request.user.sessionId)) {
    return response.status(403).json({ message: 'Request verification failed.' });
  }
  return next();
}

module.exports = { requireAuthenticatedUser, requireCsrfToken };
