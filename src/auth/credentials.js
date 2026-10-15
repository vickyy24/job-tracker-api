const { promisify } = require('node:util');
const { scrypt: scryptCallback, timingSafeEqual } = require('node:crypto');
const bcrypt = require('bcryptjs');

const BCRYPT_COST = 12;
const LEGACY_SCRYPT_COST = 32768;
const LEGACY_SCRYPT_BLOCK_SIZE = 8;
const LEGACY_SCRYPT_PARALLELIZATION = 1;
const LEGACY_KEY_LENGTH = 64;
const LEGACY_SALT_LENGTH = 16;
const LEGACY_MAX_MEMORY = 64 * 1024 * 1024;
const scrypt = promisify(scryptCallback);

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

  // Verify old scrypt accounts during the transition; all new and reset
  // passwords are written as bcrypt hashes.
  const parts = encodedHash.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, cost, blockSize, parallelization, encodedSalt, encodedKey] = parts;
  if (Number(cost) !== LEGACY_SCRYPT_COST
    || Number(blockSize) !== LEGACY_SCRYPT_BLOCK_SIZE
    || Number(parallelization) !== LEGACY_SCRYPT_PARALLELIZATION
    || !/^[A-Za-z0-9_-]{22}$/.test(encodedSalt)
    || !/^[A-Za-z0-9_-]{86}$/.test(encodedKey)) return false;

  const salt = Buffer.from(encodedSalt, 'base64url');
  const expectedKey = Buffer.from(encodedKey, 'base64url');
  if (salt.length !== LEGACY_SALT_LENGTH || expectedKey.length !== LEGACY_KEY_LENGTH) return false;
  const actualKey = await scrypt(password, salt, LEGACY_KEY_LENGTH, {
    N: LEGACY_SCRYPT_COST,
    r: LEGACY_SCRYPT_BLOCK_SIZE,
    p: LEGACY_SCRYPT_PARALLELIZATION,
    maxmem: LEGACY_MAX_MEMORY,
  });
  return timingSafeEqual(actualKey, expectedKey);
}

module.exports = {
  hashPassword,
  isValidEmail,
  normalizeEmail,
  validatePassword,
  verifyPassword,
};
