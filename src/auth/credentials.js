const bcrypt = require('bcryptjs');

const BCRYPT_COST = 12;

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : email;
}

function isValidEmail(email) {
  return typeof email === 'string'
    && email.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(password) {
  if (typeof password !== 'string') return 'Password is required.';

  const length = Array.from(password).length;
  if (length < 12) return 'Password must be at least 12 characters.';
  if (length > 128) return 'Password must be no more than 128 characters.';
  if (Buffer.byteLength(password, 'utf8') > 72) return 'Password must be no more than 72 bytes when encoded.';
  if (!/\S/.test(password)) return 'Password must contain a non-space character.';
  return null;
}

async function hashPassword(password) {
  const validationError = validatePassword(password);
  if (validationError) {
    const error = new Error(validationError);
    error.status = 400;
    throw error;
  }

  return bcrypt.hash(password, BCRYPT_COST);
}

async function verifyPassword(password, encodedHash) {
  // Sign-in must verify existing credentials without reapplying today's
  // account-creation policy (older accounts may use a shorter password).
  if (typeof password !== 'string' || password.length === 0 || password.length > 128
    || Buffer.byteLength(password, 'utf8') > 72 || typeof encodedHash !== 'string') return false;

  if (/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(encodedHash)) {
    return bcrypt.compare(password, encodedHash);
  }

  return false;
}

module.exports = {
  hashPassword,
  isValidEmail,
  normalizeEmail,
  validatePassword,
  verifyPassword,
};
