const test = require('node:test');
const assert = require('node:assert/strict');
const emailService = require('../src/services/emailService');

test('emailService: error when unconfigured', async () => {
  const origUrl = process.env.APPS_SCRIPT_URL;
  const origSecret = process.env.APPS_SCRIPT_SHARED_SECRET;
  emailService._setMockHandler(null);
  delete process.env.APPS_SCRIPT_URL;
  delete process.env.APPS_SCRIPT_SHARED_SECRET;

  try {
    await assert.rejects(
      () => emailService.sendVerificationEmail('test@example.com', '123456'),
      (err) => {
        assert.equal(err.status, 503);
        assert.ok(err.publicMessage.includes('not configured'));
        return true;
      }
    );
  } finally {
    process.env.APPS_SCRIPT_URL = origUrl;
    process.env.APPS_SCRIPT_SHARED_SECRET = origSecret;
  }
});

test('emailService: sendVerificationEmail with handler', async () => {
  let captured = null;
  emailService._setMockHandler(async (params) => {
    captured = params;
    return { success: true };
  });

  try {
    const result = await emailService.sendVerificationEmail('user@test.com', '654321', 10);
    assert.deepEqual(result, { success: true });
    assert.equal(captured.template, 'email_verification');
    assert.equal(captured.to, 'user@test.com');
    assert.equal(captured.code, '654321');
    assert.equal(captured.expiresInMinutes, 10);
  } finally {
    emailService._setMockHandler(null);
  }
});

test('emailService: sendPasswordResetEmail with handler', async () => {
  let captured = null;
  emailService._setMockHandler(async (params) => {
    captured = params;
    return { success: true };
  });

  try {
    const result = await emailService.sendPasswordResetEmail('reset@test.com', '987654', 10);
    assert.deepEqual(result, { success: true });
    assert.equal(captured.template, 'password_reset');
    assert.equal(captured.to, 'reset@test.com');
    assert.equal(captured.code, '987654');
  } finally {
    emailService._setMockHandler(null);
  }
});

test('emailService: network rejection converts to safe 502 error', async () => {
  const origFetch = global.fetch;
  process.env.APPS_SCRIPT_URL = 'https://script.google.com/macros/s/dummy/exec';
  process.env.APPS_SCRIPT_SHARED_SECRET = 'dummy-secret-32-chars-long-here!';
  emailService._setMockHandler(null);

  global.fetch = async () => ({
    ok: true,
    json: async () => ({ success: false, error: 'Unauthorized request' }),
  });

  try {
    await assert.rejects(
      () => emailService.sendVerificationEmail('test@example.com', '123456'),
      (err) => {
        assert.equal(err.status, 502);
        assert.equal(err.code, 'Unauthorized request');
        assert.ok(err.publicMessage.includes('Unable to deliver email'));
        return true;
      }
    );
  } finally {
    global.fetch = origFetch;
  }
});
