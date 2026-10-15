const test = require('node:test');
const assert = require('node:assert/strict');
const {
  hashPassword,
  isValidEmail,
  isValidUsername,
  normalizeUsername,
  validatePassword,
  verifyPassword,
} = require('../src/auth/credentials');

test('credentials: email validation', () => {
  assert.equal(isValidEmail('test@example.com'), true);
  assert.equal(isValidEmail('user.name+tag@sub.domain.co'), true);
  assert.equal(isValidEmail('a@b.c'), false, 'too short');
  assert.equal(isValidEmail('plainaddress'), false, 'no @');
  assert.equal(isValidEmail('@missinglocal.com'), false, 'missing local part');
  assert.equal(isValidEmail('missingdomain@.com'), false, 'missing domain name');
  assert.equal(isValidEmail('spaces in@email.com'), false, 'spaces in local');
  assert.equal(isValidEmail(null), false);
  assert.equal(isValidEmail(undefined), false);
});

test('credentials: username normalization and validation', () => {
  assert.equal(normalizeUsername('  User@Example.COM  '), 'user@example.com');
  assert.equal(isValidUsername('john_doe'), true);
  assert.equal(isValidUsername('test@example.com'), true);
  assert.equal(isValidUsername('ab'), false, 'too short username');
});

test('credentials: password validation rules', () => {
  assert.equal(validatePassword('short'), 'Password must be at least 12 characters.');
  assert.equal(validatePassword('            '), 'Password must contain a non-space character.');
  assert.equal(validatePassword('ValidPassword123!'), null);
  assert.equal(validatePassword('a'.repeat(129)), 'Password must be no more than 128 characters.');
  assert.equal(validatePassword('🔑'.repeat(25)), 'Password must be no more than 72 bytes when encoded.');
});

test('credentials: password hashing and verification', async () => {
  const plain = 'StrongPassphrase!2026';
  const encoded = await hashPassword(plain);
  assert.ok(/^\$2[abxy]\$\d{2}\$/.test(encoded));
  assert.equal(await verifyPassword(plain, encoded), true);
  assert.equal(await verifyPassword('WrongPassword123!', encoded), false);
});
