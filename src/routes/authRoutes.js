const { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } = require('node:crypto');
const express = require('express');
const AuthRateLimit = require('../models/AuthRateLimit');
const AuthSession = require('../models/AuthSession');
const User = require('../models/User');
const { hashPassword, isValidEmail, normalizeEmail, validatePassword, verifyPassword } = require('../auth/credentials');
const { requireTrustedOrigin } = require('../auth');
const { sendPasswordResetCode, sendVerificationCode } = require('../services/emailService');
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
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
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
    user: { id: String(user._id), firstName: user.firstName, lastName: user.lastName, email: user.email },
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

function accountName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name.length > 0 && name.length <= 80 ? name : null;
}

function otpHash(email, code) {
  const secret = process.env.JWT_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    const error = new Error('Authentication is not configured.');
    error.status = 503;
    throw error;
  }
  return createHmac('sha256', secret).update(`jobtrack-email-otp-v1:${email}:${code}`).digest('base64url');
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
  }], { upsert: true, new: true, updatePipeline: true }).lean();

  if (counter.count <= limit) return true;
  response.set('Retry-After', String(Math.max(1, Math.ceil((new Date(counter.resetAt).getTime() - now.getTime()) / 1000))));
  response.status(429).json({ message: 'Too many attempts. Please wait and try again.' });
  return false;
}

async function issueVerificationCode(user) {
  const code = String(randomInt(100000, 1000000));
  await sendVerificationCode(user.email, code);
  const now = new Date();
  await User.updateOne({ _id: user._id, emailVerifiedAt: null }, {
    $set: {
      verificationCodeHash: otpHash(user.email, code),
      verificationCodeExpiresAt: new Date(now.getTime() + OTP_TTL_MS),
      verificationAttempts: 0,
      verificationSentAt: now,
    },
  });
}

function passwordResetOtpHash(email, code) {
  const secret = process.env.JWT_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    const error = new Error('Authentication is not configured.');
    error.status = 503;
    throw error;
  }
  return createHmac('sha256', secret).update(`jobtrack-password-reset-v1:${email}:${code}`).digest('base64url');
}

const genericPasswordResetResponse = { message: 'If an account exists for that email, a password reset code has been sent.' };

router.post('/forgot-password', async (request, response) => {
  if (!(await rateLimit(request, response, 'forgot-password', 5, 60 * 60 * 1000))) return;
  const email = normalizeEmail(request.body?.email);
  if (!isValidEmail(email)) return response.status(202).json(genericPasswordResetResponse);

  // The reset code is itself an email ownership check. Allow pending and
  // legacy accounts to recover access; successful reset also verifies them.
  const user = await User.findOne({ email }).select('+passwordResetSentAt');
  if (!user) return response.status(202).json(genericPasswordResetResponse);
  if (user.passwordResetSentAt && Date.now() - user.passwordResetSentAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
    return response.status(202).json(genericPasswordResetResponse);
  }

  const code = String(randomInt(100000, 1000000));
  await sendPasswordResetCode(user.email, code);
  const now = new Date();
  await User.updateOne({ _id: user._id }, {
    $set: {
      passwordResetCodeHash: passwordResetOtpHash(user.email, code),
      passwordResetCodeExpiresAt: new Date(now.getTime() + OTP_TTL_MS),
      passwordResetAttempts: 0,
      passwordResetSentAt: now,
    },
  });
  return response.status(202).json(genericPasswordResetResponse);
});

router.post('/reset-password', async (request, response) => {
  if (!(await rateLimit(request, response, 'reset-password', 10, 15 * 60 * 1000))) return;
  const email = normalizeEmail(request.body?.email);
  const code = typeof request.body?.code === 'string' ? request.body.code.trim() : '';
  const password = request.body?.password;
  const passwordError = validatePassword(password);
  if (!isValidEmail(email) || !/^\d{6}$/.test(code) || passwordError) {
    return response.status(400).json({ message: passwordError || 'Enter the email address and six-digit code.' });
  }

  const user = await User.findOne({ email })
    .select('+passwordResetCodeHash +passwordResetCodeExpiresAt +passwordResetAttempts');
  const invalidCodeMessage = 'That code is invalid or expired. Request a new code and try again.';
  if (!user || !user.passwordResetCodeHash || !user.passwordResetCodeExpiresAt || user.passwordResetCodeExpiresAt <= new Date() || user.passwordResetAttempts >= OTP_MAX_ATTEMPTS) {
    return response.status(400).json({ message: invalidCodeMessage });
  }

  const expectedHash = Buffer.from(user.passwordResetCodeHash, 'base64url');
  const submittedHash = Buffer.from(passwordResetOtpHash(email, code), 'base64url');
  const matches = expectedHash.length === submittedHash.length && timingSafeEqual(expectedHash, submittedHash);
  if (!matches) {
    await User.updateOne({ _id: user._id, passwordResetCodeHash: user.passwordResetCodeHash, passwordResetAttempts: { $lt: OTP_MAX_ATTEMPTS } }, { $inc: { passwordResetAttempts: 1 } });
    return response.status(400).json({ message: invalidCodeMessage });
  }

  const passwordHash = await hashPassword(password);
  const updated = await User.updateOne({
    _id: user._id,
    passwordResetCodeHash: user.passwordResetCodeHash,
    passwordResetCodeExpiresAt: { $gt: new Date() },
    passwordResetAttempts: { $lt: OTP_MAX_ATTEMPTS },
  }, {
    $set: { passwordHash, emailVerifiedAt: user.emailVerifiedAt || new Date() },
    $unset: {
      passwordResetCodeHash: '', passwordResetCodeExpiresAt: '', passwordResetAttempts: '', passwordResetSentAt: '',
      verificationCodeHash: '', verificationCodeExpiresAt: '', verificationAttempts: '', verificationSentAt: '',
    },
  });
  if (!updated.modifiedCount) return response.status(400).json({ message: invalidCodeMessage });

  await AuthSession.updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
  return response.json({ message: 'Password updated. Sign in with your new password.' });
});

const genericVerificationResponse = { message: 'If this email can be registered, a verification code has been sent.' };

router.post('/register', async (request, response) => {
  try {
    if (!(await rateLimit(request, response, 'register', 5, 60 * 60 * 1000))) return;
  } catch (error) {
    error.operation = 'auth.register.rate-limit';
    throw error;
  }
  const credentials = credentialsFrom(request);
  const firstName = accountName(request.body?.firstName);
  const lastName = accountName(request.body?.lastName);
  if (!credentials || !firstName || !lastName) {
    return response.status(400).json({ message: 'Enter your first name, last name, a valid email, and password.' });
  }

  const passwordError = validatePassword(credentials.password);
  if (passwordError) return response.status(400).json({ message: passwordError });

  let user;
  try {
    user = await User.create({ firstName, lastName, email: credentials.email, passwordHash: await hashPassword(credentials.password) });
  } catch (error) {
    if (error.code === 11000) {
      user = await User.findOne({ email: credentials.email }).select('+emailVerifiedAt +verificationSentAt');
      if (!user || user.emailVerifiedAt) return response.status(202).json(genericVerificationResponse);
      // Older pending registrations may have been created before names were
      // required. Refresh their submitted names without changing the password.
      await User.updateOne({ _id: user._id, emailVerifiedAt: null }, { $set: { firstName, lastName } });
      user.firstName = firstName;
      user.lastName = lastName;
    }
    else {
      error.operation = 'auth.register.create-user';
      throw error;
    }
  }

  const recentlySent = user.verificationSentAt && Date.now() - user.verificationSentAt.getTime() < OTP_RESEND_COOLDOWN_MS;
  if (recentlySent) return response.status(202).json(genericVerificationResponse);
  try {
    await issueVerificationCode(user);
  } catch (error) {
    error.operation = 'auth.register.send-verification';
    // The account is already safely stored as pending verification. Give a
    // recoverable response without exposing Gmail/provider details; a retry
    // will send a fresh code for this unverified account.
    error.status = 503;
    error.publicMessage = 'We could not send the verification email. Check the API email settings and try again.';
    throw error;
  }
  return response.status(202).json(genericVerificationResponse);
});

router.post('/verify-email', async (request, response) => {
  if (!(await rateLimit(request, response, 'verify-email', 10, 15 * 60 * 1000))) return;
  const email = normalizeEmail(request.body?.email);
  const code = typeof request.body?.code === 'string' ? request.body.code.trim() : '';
  if (!isValidEmail(email) || !/^\d{6}$/.test(code)) {
    return response.status(400).json({ message: 'Enter the email address and six-digit code.' });
  }

  const user = await User.findOne({ email, emailVerifiedAt: null })
    .select('+verificationCodeHash +verificationCodeExpiresAt +verificationAttempts');
  if (!user || !user.verificationCodeHash || !user.verificationCodeExpiresAt || user.verificationCodeExpiresAt <= new Date() || user.verificationAttempts >= OTP_MAX_ATTEMPTS) {
    return response.status(400).json({ message: 'That code is invalid or expired. Request a new code and try again.' });
  }

  const expectedHash = Buffer.from(user.verificationCodeHash, 'base64url');
  const submittedHash = Buffer.from(otpHash(email, code), 'base64url');
  const matches = expectedHash.length === submittedHash.length && timingSafeEqual(expectedHash, submittedHash);
  if (!matches) {
    await User.updateOne({ _id: user._id, emailVerifiedAt: null, verificationAttempts: { $lt: OTP_MAX_ATTEMPTS } }, { $inc: { verificationAttempts: 1 } });
    return response.status(400).json({ message: 'That code is invalid or expired. Request a new code and try again.' });
  }

  const verified = await User.updateOne({
    _id: user._id,
    emailVerifiedAt: null,
    verificationCodeHash: user.verificationCodeHash,
    verificationCodeExpiresAt: { $gt: new Date() },
    verificationAttempts: { $lt: OTP_MAX_ATTEMPTS },
  }, {
    $set: { emailVerifiedAt: new Date() },
    $unset: { verificationCodeHash: '', verificationCodeExpiresAt: '', verificationAttempts: '', verificationSentAt: '' },
  });
  if (!verified.modifiedCount) return response.status(400).json({ message: 'That code is invalid or expired. Request a new code and try again.' });
  return response.json({ message: 'Email verified. You can now sign in.' });
});

router.post('/resend-verification', async (request, response) => {
  if (!(await rateLimit(request, response, 'resend-verification', 5, 60 * 60 * 1000))) return;
  const email = normalizeEmail(request.body?.email);
  if (!isValidEmail(email)) return response.status(202).json(genericVerificationResponse);

  const user = await User.findOne({ email, emailVerifiedAt: null }).select('+verificationSentAt');
  if (!user) return response.status(202).json(genericVerificationResponse);
  if (user.verificationSentAt && Date.now() - user.verificationSentAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
    return response.status(429).json({ message: 'Please wait a minute before requesting another code.' });
  }
  await issueVerificationCode(user);
  return response.status(202).json(genericVerificationResponse);
});

router.post('/login', async (request, response) => {
  if (!(await rateLimit(request, response, 'login', 10, 15 * 60 * 1000))) return;
  const credentials = credentialsFrom(request);
  if (!credentials || credentials.password.length === 0 || credentials.password.length > 128) {
    return response.status(401).json({ message: 'Email or password is incorrect.' });
  }

  const user = await User.findOne({ email: credentials.email }).select('+passwordHash');
  if (!user || !(await verifyPassword(credentials.password, user.passwordHash))) {
    return response.status(401).json({ message: 'Email or password is incorrect.' });
  }
  if (!user.emailVerifiedAt) return response.status(403).json({ message: 'Verify your email before signing in.' });

  return response.json(await createSession(user, response, request.body?.rememberMe !== false));
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

  const user = await User.findById(claims.sub).select('_id firstName lastName email emailVerifiedAt');
  if (!user || !user.emailVerifiedAt) return response.status(401).json({ message: 'Authentication required.' });
  return response.json({ user: { id: String(user._id), firstName: user.firstName, lastName: user.lastName, email: user.email }, csrfToken: createCsrfToken(claims.sid) });
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

  const user = await User.findById(rotatedSession.userId).select('_id firstName lastName email emailVerifiedAt');
  if (!user || !user.emailVerifiedAt) {
    await AuthSession.updateOne({ _id: rotatedSession._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
    clearSessionCookies(response);
    return response.status(401).json({ message: 'Authentication required.' });
  }

  response.cookie(accessCookieName(), signAccessToken(user._id, rotatedSession._id, ACCESS_TTL_SECONDS), cookieOptions(rotatedSession.rememberMe ? ACCESS_TTL_SECONDS * 1000 : undefined));
  response.cookie(refreshCookieName(), refreshToken, cookieOptions(rotatedSession.rememberMe ? REFRESH_TTL_MS : undefined));
  return response.json({ user: { id: String(user._id), firstName: user.firstName, lastName: user.lastName, email: user.email }, csrfToken: createCsrfToken(rotatedSession._id) });
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
