const { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } = require('node:crypto');
const express = require('express');
const AuthOtp = require('../models/AuthOtp');
const AuthRateLimit = require('../models/AuthRateLimit');
const AuthSession = require('../models/AuthSession');
const User = require('../models/User');
const { hashPassword, normalizeUsername, isValidEmail, isValidUsername, validatePassword, verifyPassword } = require('../auth/credentials');
const { requireTrustedOrigin } = require('../auth');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../services/emailService');
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
    user: {
      id: String(user._id),
      email: user.username,
      username: user.username,
      firstName: user.firstName || '',
      lastName: user.lastName || '',
    },
    csrfToken: createCsrfToken(session._id),
  };
}

function credentialsFrom(request) {
  if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) return null;
  const rawEmail = request.body.email || request.body.username;
  const email = normalizeUsername(rawEmail);
  const { password } = request.body;
  if (!isValidEmail(email) || typeof password !== 'string') return null;
  return { email, username: email, password };
}

function otpHash(purpose, email, code) {
  const secret = process.env.JWT_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    const error = new Error('Authentication is not configured.');
    error.status = 503;
    throw error;
  }
  return createHmac('sha256', secret).update(`jobtrack-otp-v2:${purpose}:${email}:${code}`).digest('base64url');
}

function createOtp() {
  return String(randomInt(100000, 1000000));
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

// -------------------------------------------------------------
// 1. REGISTRATION & EMAIL VERIFICATION
// -------------------------------------------------------------

router.post('/register', async (request, response) => {
  if (!(await rateLimit(request, response, 'register', 5, 60 * 60 * 1000))) return;
  const credentials = credentialsFrom(request);
  const confirmPassword = request.body?.confirmPassword;
  if (!credentials || !isValidEmail(credentials.username)) {
    return response.status(400).json({ message: 'Enter a valid email address to register.' });
  }
  if (credentials.password !== confirmPassword) {
    return response.status(400).json({ message: 'Passwords do not match.' });
  }
  const passwordError = validatePassword(credentials.password);
  if (passwordError) return response.status(400).json({ message: passwordError });

  const email = credentials.username;
  if (await User.exists({ username: email })) {
    return response.status(409).json({ message: 'An account with this email already exists.' });
  }

  const existingOtp = await AuthOtp.findOne({ email, purpose: 'email_verification' });
  const existingSentAt = existingOtp?.sentAt ? new Date(existingOtp.sentAt).getTime() : 0;
  if (existingOtp && Date.now() - existingSentAt < OTP_RESEND_COOLDOWN_MS) {
    return response.status(429).json({ message: 'Please wait a minute before requesting another code.' });
  }

  const firstName = typeof request.body?.firstName === 'string' ? request.body.firstName.trim().slice(0, 80) : '';
  const lastName = typeof request.body?.lastName === 'string' ? request.body.lastName.trim().slice(0, 80) : '';

  try {
    const passwordHash = await hashPassword(credentials.password);
    const code = createOtp();
    const now = new Date();

    await AuthOtp.findOneAndUpdate(
      { email, purpose: 'email_verification' },
      {
        $set: {
          codeHash: otpHash('email_verification', email, code),
          pendingPasswordHash: passwordHash,
          pendingFirstName: firstName,
          pendingLastName: lastName,
          attempts: 0,
          sentAt: now,
          expiresAt: new Date(now.getTime() + OTP_TTL_MS),
        },
      },
      { upsert: true, returnDocument: 'after' }
    );

    await sendVerificationEmail(email, code);
    return response.status(202).json({ email, message: 'Verification code sent. Enter the six-digit code from your email.' });
  } catch (error) {
    error.operation = error.operation || 'auth.register.send-verification';
    throw error;
  }
});

router.post('/verify-email', async (request, response) => {
  if (!(await rateLimit(request, response, 'verify-email', 15, 15 * 60 * 1000))) return;
  const email = normalizeUsername(request.body?.email);
  const code = typeof request.body?.code === 'string' ? request.body.code.trim() : '';
  if (!isValidEmail(email) || !/^\d{6}$/.test(code)) {
    return response.status(400).json({ message: 'Enter a valid email and the six-digit verification code.' });
  }

  const otpDoc = await AuthOtp.findOne({
    email,
    purpose: 'email_verification',
    expiresAt: { $gt: new Date() },
  }).select('+pendingPasswordHash');

  const invalidCodeMessage = 'That code is invalid or expired. Request a new code and try again.';
  if (!otpDoc || !otpDoc.codeHash || otpDoc.attempts >= OTP_MAX_ATTEMPTS) {
    if (otpDoc) await AuthOtp.deleteOne({ _id: otpDoc._id });
    return response.status(400).json({ message: invalidCodeMessage });
  }

  const expected = Buffer.from(otpDoc.codeHash, 'base64url');
  const submitted = Buffer.from(otpHash('email_verification', email, code), 'base64url');
  const matches = expected.length === submitted.length && timingSafeEqual(expected, submitted);

  if (!matches) {
    const updated = await AuthOtp.findOneAndUpdate({ _id: otpDoc._id }, { $inc: { attempts: 1 } }, { returnDocument: 'after' });
    if (!updated || updated.attempts >= OTP_MAX_ATTEMPTS) {
      await AuthOtp.deleteOne({ _id: otpDoc._id });
    }
    return response.status(400).json({ message: invalidCodeMessage });
  }

  if (await User.exists({ username: email })) {
    await AuthOtp.deleteOne({ _id: otpDoc._id });
    return response.status(409).json({ message: 'An account with this email already exists.' });
  }

  let user;
  try {
    user = await User.create({
      username: email,
      firstName: otpDoc.pendingFirstName || '',
      lastName: otpDoc.pendingLastName || '',
      passwordHash: otpDoc.pendingPasswordHash,
    });
  } catch (error) {
    await AuthOtp.deleteOne({ _id: otpDoc._id });
    if (error.code === 11000) return response.status(409).json({ message: 'An account with this email already exists.' });
    error.operation = 'auth.verify-email.create-user';
    throw error;
  }

  await AuthOtp.deleteOne({ _id: otpDoc._id });

  try {
    return response.status(201).json(await createSession(user, response));
  } catch (error) {
    error.operation = 'auth.verify-email.create-session';
    throw error;
  }
});

router.post('/resend-verification', async (request, response) => {
  if (!(await rateLimit(request, response, 'resend-verification', 10, 60 * 60 * 1000))) return;
  const email = normalizeUsername(request.body?.email);
  if (!isValidEmail(email)) return response.status(400).json({ message: 'Enter a valid email address.' });

  const otpDoc = await AuthOtp.findOne({
    email,
    purpose: 'email_verification',
    expiresAt: { $gt: new Date() },
  });

  if (!otpDoc) {
    return response.status(404).json({ message: 'Registration has expired. Please start registration again.' });
  }

  const otpSentAt = otpDoc?.sentAt ? new Date(otpDoc.sentAt).getTime() : 0;
  if (Date.now() - otpSentAt < OTP_RESEND_COOLDOWN_MS) {
    return response.status(429).json({ message: 'Please wait a minute before requesting another code.' });
  }

  try {
    const code = createOtp();
    const now = new Date();
    otpDoc.codeHash = otpHash('email_verification', email, code);
    otpDoc.attempts = 0;
    otpDoc.sentAt = now;
    otpDoc.expiresAt = new Date(now.getTime() + OTP_TTL_MS);
    await otpDoc.save();

    await sendVerificationEmail(email, code);
    return response.status(202).json({ email, message: 'A new verification code was sent.' });
  } catch (error) {
    error.operation = error.operation || 'auth.resend-verification.send-email';
    throw error;
  }
});

// -------------------------------------------------------------
// 2. FORGOT PASSWORD & RESET PASSWORD
// -------------------------------------------------------------

router.post('/forgot-password', async (request, response) => {
  if (!(await rateLimit(request, response, 'forgot-password', 5, 15 * 60 * 1000))) return;
  const email = normalizeUsername(request.body?.email);
  if (!isValidEmail(email)) {
    return response.status(400).json({ message: 'Enter a valid email address.' });
  }

  const genericSuccessMessage = 'If an account exists with this email, a verification code has been sent.';

  const user = await User.findOne({ username: email }).select('_id');
  if (!user) {
    return response.json({ message: genericSuccessMessage });
  }

  const existingOtp = await AuthOtp.findOne({ email, purpose: 'password_reset' });
  const existingSentAt = existingOtp?.sentAt ? new Date(existingOtp.sentAt).getTime() : 0;
  if (existingOtp && Date.now() - existingSentAt < OTP_RESEND_COOLDOWN_MS) {
    // Account exists but within cooldown: return generic message to prevent enumeration while preventing email spam
    return response.json({ message: genericSuccessMessage });
  }

  try {
    const code = createOtp();
    const now = new Date();

    await AuthOtp.findOneAndUpdate(
      { email, purpose: 'password_reset' },
      {
        $set: {
          userId: user._id,
          codeHash: otpHash('password_reset', email, code),
          resetTokenHash: null,
          attempts: 0,
          sentAt: now,
          expiresAt: new Date(now.getTime() + OTP_TTL_MS),
        },
      },
      { upsert: true, returnDocument: 'after' }
    );

    await sendPasswordResetEmail(email, code);
    return response.json({ message: genericSuccessMessage });
  } catch (error) {
    error.operation = error.operation || 'auth.forgot-password.send-email';
    throw error;
  }
});

router.post('/verify-reset-code', async (request, response) => {
  if (!(await rateLimit(request, response, 'verify-reset-code', 15, 15 * 60 * 1000))) return;
  const email = normalizeUsername(request.body?.email);
  const code = typeof request.body?.code === 'string' ? request.body.code.trim() : '';
  if (!isValidEmail(email) || !/^\d{6}$/.test(code)) {
    return response.status(400).json({ message: 'Enter a valid email and the six-digit verification code.' });
  }

  const otpDoc = await AuthOtp.findOne({
    email,
    purpose: 'password_reset',
    expiresAt: { $gt: new Date() },
  });

  const invalidCodeMessage = 'That code is invalid or expired. Request a new code and try again.';
  if (!otpDoc || !otpDoc.codeHash || otpDoc.attempts >= OTP_MAX_ATTEMPTS) {
    if (otpDoc && !otpDoc.resetTokenHash) await AuthOtp.deleteOne({ _id: otpDoc._id });
    return response.status(400).json({ message: invalidCodeMessage });
  }

  const expected = Buffer.from(otpDoc.codeHash, 'base64url');
  const submitted = Buffer.from(otpHash('password_reset', email, code), 'base64url');
  const matches = expected.length === submitted.length && timingSafeEqual(expected, submitted);

  if (!matches) {
    const updated = await AuthOtp.findOneAndUpdate({ _id: otpDoc._id }, { $inc: { attempts: 1 } }, { returnDocument: 'after' });
    if (!updated || updated.attempts >= OTP_MAX_ATTEMPTS) {
      await AuthOtp.deleteOne({ _id: otpDoc._id });
    }
    return response.status(400).json({ message: invalidCodeMessage });
  }

  // Code verified! Generate single-use reset authorization token and invalidate the 6-digit code.
  const resetToken = randomBytes(32).toString('base64url');
  otpDoc.codeHash = null;
  otpDoc.resetTokenHash = tokenHash(resetToken);
  otpDoc.attempts = 0;
  otpDoc.expiresAt = new Date(Date.now() + OTP_TTL_MS);
  await otpDoc.save();

  return response.json({
    resetToken,
    message: 'Code verified successfully. Please enter your new password.',
  });
});

router.post('/resend-reset-code', async (request, response) => {
  if (!(await rateLimit(request, response, 'resend-reset-code', 10, 60 * 60 * 1000))) return;
  const email = normalizeUsername(request.body?.email);
  if (!isValidEmail(email)) return response.status(400).json({ message: 'Enter a valid email address.' });

  const genericSuccessMessage = 'If an account exists with this email, a verification code has been sent.';
  const user = await User.findOne({ username: email }).select('_id');
  if (!user) {
    return response.json({ message: genericSuccessMessage });
  }

  const otpDoc = await AuthOtp.findOne({
    email,
    purpose: 'password_reset',
    expiresAt: { $gt: new Date() },
  });

  const otpSentAt = otpDoc?.sentAt ? new Date(otpDoc.sentAt).getTime() : 0;
  if (otpDoc && Date.now() - otpSentAt < OTP_RESEND_COOLDOWN_MS) {
    return response.status(429).json({ message: 'Please wait a minute before requesting another code.' });
  }

  try {
    const code = createOtp();
    const now = new Date();

    await AuthOtp.findOneAndUpdate(
      { email, purpose: 'password_reset' },
      {
        $set: {
          userId: user._id,
          codeHash: otpHash('password_reset', email, code),
          resetTokenHash: null,
          attempts: 0,
          sentAt: now,
          expiresAt: new Date(now.getTime() + OTP_TTL_MS),
        },
      },
      { upsert: true, returnDocument: 'after' }
    );

    await sendPasswordResetEmail(email, code);
    return response.json({ message: genericSuccessMessage });
  } catch (error) {
    error.operation = error.operation || 'auth.resend-reset-code.send-email';
    throw error;
  }
});

router.post('/reset-password', async (request, response) => {
  if (!(await rateLimit(request, response, 'reset-password', 10, 15 * 60 * 1000))) return;
  const email = normalizeUsername(request.body?.email);
  const resetToken = typeof request.body?.resetToken === 'string' ? request.body.resetToken.trim() : '';
  const newPassword = request.body?.newPassword;
  const confirmPassword = request.body?.confirmPassword;

  if (!isValidEmail(email) || !resetToken || typeof newPassword !== 'string') {
    return response.status(400).json({ message: 'Invalid password reset request.' });
  }

  if (newPassword !== confirmPassword) {
    return response.status(400).json({ message: 'Passwords do not match.' });
  }

  const passwordError = validatePassword(newPassword);
  if (passwordError) return response.status(400).json({ message: passwordError });

  const otpDoc = await AuthOtp.findOne({
    email,
    purpose: 'password_reset',
    expiresAt: { $gt: new Date() },
  }).select('+resetTokenHash');

  if (!otpDoc || !otpDoc.resetTokenHash) {
    return response.status(400).json({ message: 'Password reset session is invalid or expired. Please request a new code.' });
  }

  const expected = Buffer.from(otpDoc.resetTokenHash, 'base64url');
  const submitted = Buffer.from(tokenHash(resetToken), 'base64url');
  const matches = expected.length === submitted.length && timingSafeEqual(expected, submitted);

  if (!matches) {
    await AuthOtp.deleteOne({ _id: otpDoc._id });
    return response.status(400).json({ message: 'Password reset session is invalid or expired. Please request a new code.' });
  }

  const user = await User.findById(otpDoc.userId).select('+passwordHash');
  if (!user) {
    await AuthOtp.deleteOne({ _id: otpDoc._id });
    return response.status(400).json({ message: 'Unable to reset password.' });
  }

  try {
    user.passwordHash = await hashPassword(newPassword);
    await user.save();

    // Revoke all existing sessions for this user on password reset
    await AuthSession.updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });

    // Clean up OTP record to prevent reuse
    await AuthOtp.deleteOne({ _id: otpDoc._id });

    // Clear any cookies from client
    clearSessionCookies(response);

    return response.json({ message: 'Your password has been reset successfully. Please sign in with your new password.' });
  } catch (error) {
    error.operation = 'auth.reset-password.update-user';
    throw error;
  }
});

// -------------------------------------------------------------
// 3. LOGIN & SESSION LIFECYCLE
// -------------------------------------------------------------

router.post('/login', async (request, response) => {
  if (!(await rateLimit(request, response, 'login', 10, 15 * 60 * 1000))) return;
  const credentials = credentialsFrom(request);
  if (!credentials || credentials.password.length === 0 || credentials.password.length > 128) {
    return response.status(401).json({ message: 'Email or password is incorrect.' });
  }

  const user = await User.findOne({ username: credentials.email }).select('+passwordHash');
  if (!user) {
    console.warn('[auth:login-failed]', { reason: 'account-not-found' });
    return response.status(401).json({ message: 'Email or password is incorrect.' });
  }
  if (!(await verifyPassword(credentials.password, user.passwordHash))) {
    console.warn('[auth:login-failed]', { reason: 'password-mismatch' });
    return response.status(401).json({ message: 'Email or password is incorrect.' });
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

  const user = await User.findById(claims.sub).select('_id username firstName lastName');
  if (!user) return response.status(401).json({ message: 'Authentication required.' });
  return response.json({
    user: {
      id: String(user._id),
      email: user.username,
      username: user.username,
      firstName: user.firstName || '',
      lastName: user.lastName || '',
    },
    csrfToken: createCsrfToken(claims.sid),
  });
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

  const user = await User.findById(rotatedSession.userId).select('_id username firstName lastName');
  if (!user) {
    await AuthSession.updateOne({ _id: rotatedSession._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
    clearSessionCookies(response);
    return response.status(401).json({ message: 'Authentication required.' });
  }

  response.cookie(accessCookieName(), signAccessToken(user._id, rotatedSession._id, ACCESS_TTL_SECONDS), cookieOptions(rotatedSession.rememberMe ? ACCESS_TTL_SECONDS * 1000 : undefined));
  response.cookie(refreshCookieName(), refreshToken, cookieOptions(rotatedSession.rememberMe ? REFRESH_TTL_MS : undefined));
  return response.json({
    user: {
      id: String(user._id),
      email: user.username,
      username: user.username,
      firstName: user.firstName || '',
      lastName: user.lastName || '',
    },
    csrfToken: createCsrfToken(rotatedSession._id),
  });
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
