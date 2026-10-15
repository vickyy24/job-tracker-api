const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const mongoose = require('mongoose');

process.env.JWT_SECRET = 'a'.repeat(64);
process.env.FRONTEND_ORIGIN = 'http://localhost:3000';
process.env.NODE_ENV = 'test';

const { createApp } = require('../src/app');
const User = require('../src/models/User');
const AuthOtp = require('../src/models/AuthOtp');
const AuthRateLimit = require('../src/models/AuthRateLimit');
const AuthSession = require('../src/models/AuthSession');
const emailService = require('../src/services/emailService');

// In-memory data store for testing
const db = {
  users: new Map(),
  otps: new Map(),
  rateLimits: new Map(),
  sessions: new Map(),
  clear() {
    this.users.clear();
    this.otps.clear();
    this.rateLimits.clear();
    this.sessions.clear();
  },
};

// Wire up in-memory mocks on Mongoose models
function setupModelMocks() {
  // --- User ---
  User.exists = async (filter) => {
    if (filter.username) {
      for (const u of db.users.values()) {
        if (u.username === filter.username) return { _id: u._id };
      }
    }
    if (filter._id) {
      return db.users.has(String(filter._id)) ? { _id: filter._id } : null;
    }
    return null;
  };

  User.create = async (data) => {
    const id = new mongoose.Types.ObjectId();
    const doc = {
      _id: id,
      username: data.username,
      passwordHash: data.passwordHash,
      save: async function () {
        db.users.set(String(this._id), this);
        return this;
      },
    };
    db.users.set(String(id), doc);
    return doc;
  };

function createQuery(result) {
  return {
    select: () => createQuery(result),
    lean: () => Promise.resolve(result),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    catch: (reject) => Promise.resolve(result).catch(reject),
  };
}

  User.findOne = (filter) => {
    let matched = null;
    if (filter.username) {
      for (const u of db.users.values()) {
        if (u.username === filter.username) {
          matched = u;
          break;
        }
      }
    }
    return createQuery(matched);
  };

  User.findById = (id) => {
    const matched = db.users.get(String(id));
    return createQuery(matched);
  };

  // --- AuthOtp ---
  AuthOtp.findOne = (filter) => {
    let matched = null;
    for (const otp of db.otps.values()) {
      let ok = true;
      if (filter.email && otp.email !== filter.email) ok = false;
      if (filter.purpose && otp.purpose !== filter.purpose) ok = false;
      if (filter.expiresAt && filter.expiresAt.$gt && otp.expiresAt <= filter.expiresAt.$gt) ok = false;
      if (ok) {
        matched = {
          ...otp,
          save: async function () {
            db.otps.set(`${this.email}:${this.purpose}`, this);
            return this;
          },
        };
        break;
      }
    }
    return createQuery(matched);
  };

  AuthOtp.findOneAndUpdate = async (filter, update) => {
    let existing = null;
    let key = null;
    if (filter._id) {
      for (const [k, v] of db.otps.entries()) {
        if (String(v._id) === String(filter._id)) {
          existing = v;
          key = k;
          break;
        }
      }
    } else if (filter.email && filter.purpose) {
      key = `${filter.email}:${filter.purpose}`;
      existing = db.otps.get(key);
    }

    if (!existing) {
      existing = {
        _id: filter._id || new mongoose.Types.ObjectId(),
        email: filter.email,
        purpose: filter.purpose,
        attempts: 0,
      };
      if (key) db.otps.set(key, existing);
    }

    if (update.$set) {
      Object.assign(existing, update.$set);
    }
    if (update.$inc) {
      for (const [k, v] of Object.entries(update.$inc)) {
        existing[k] = (existing[k] || 0) + v;
      }
    }

    existing.save = async function () {
      db.otps.set(`${this.email}:${this.purpose}`, this);
      return this;
    };

    if (key) db.otps.set(key, existing);
    return existing;
  };

  AuthOtp.deleteOne = async (filter) => {
    for (const [key, val] of db.otps.entries()) {
      if (filter._id && String(val._id) === String(filter._id)) {
        db.otps.delete(key);
      }
    }
    return { deletedCount: 1 };
  };

  // --- AuthRateLimit ---
  AuthRateLimit.findOneAndUpdate = (filter, pipeline) => {
    const key = filter.key;
    let record = db.rateLimits.get(key) || { count: 0, resetAt: new Date(Date.now() + 60000) };
    record.count += 1;
    db.rateLimits.set(key, record);
    const result = {
      count: record.count,
      resetAt: record.resetAt,
    };
    return {
      lean: () => Promise.resolve(result),
      then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    };
  };

  // --- AuthSession ---
  AuthSession.create = async (data) => {
    const id = new mongoose.Types.ObjectId();
    const doc = {
      _id: id,
      ...data,
      save: async function () {
        db.sessions.set(String(this._id), this);
        return this;
      },
    };
    db.sessions.set(String(id), doc);
    return doc;
  };

  AuthSession.findOne = () => ({
    select: () => null,
  });

  AuthSession.updateMany = async (filter, update) => {
    let modified = 0;
    for (const session of db.sessions.values()) {
      if (String(session.userId) === String(filter.userId)) {
        Object.assign(session, update.$set);
        modified += 1;
      }
    }
    return { modifiedCount: modified };
  };

  AuthSession.updateOne = async () => ({ modifiedCount: 1 });
  AuthSession.exists = async () => null;
}

setupModelMocks();

async function makeRequest(server, path, method = 'GET', body = null, headers = {}) {
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}${path}`;
  const defaultHeaders = {
    'Origin': 'http://localhost:3000',
    ...(body ? { 'Content-Type': 'application/json' } : {}),
    ...headers,
  };

  const response = await fetch(url, {
    method,
    headers: defaultHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json().catch(() => null);
  return { status: response.status, data, headers: response.headers };
}

test('Auth flow tests', async (t) => {
  const app = createApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  let lastSentEmail = null;
  emailService._setMockHandler(async (opts) => {
    lastSentEmail = opts;
    return { success: true };
  });

  await t.test('POST /api/auth/register: rejects invalid email and weak password', async () => {
    db.clear();
    const res1 = await makeRequest(server, '/api/auth/register', 'POST', {
      username: 'notanemail',
      password: 'ValidPassword123!',
      confirmPassword: 'ValidPassword123!',
    });
    assert.equal(res1.status, 400);
    assert.ok(res1.data.message.includes('valid email address'));

    const res2 = await makeRequest(server, '/api/auth/register', 'POST', {
      username: 'user@example.com',
      password: 'short',
      confirmPassword: 'short',
    });
    assert.equal(res2.status, 400);
    assert.ok(res2.data.message.includes('at least 12 characters'));

    const res3 = await makeRequest(server, '/api/auth/register', 'POST', {
      username: 'user@example.com',
      password: 'ValidPassword123!',
      confirmPassword: 'MismatchPassword123!',
    });
    assert.equal(res3.status, 400);
    assert.ok(res3.data.message.includes('do not match'));
  });

  await t.test('POST /api/auth/register: valid registration sends OTP and creates AuthOtp', async () => {
    db.clear();
    lastSentEmail = null;

    const res = await makeRequest(server, '/api/auth/register', 'POST', {
      username: 'newuser@example.com',
      password: 'SuperSecurePassword2026!',
      confirmPassword: 'SuperSecurePassword2026!',
    });

    assert.equal(res.status, 202);
    assert.equal(res.data.email, 'newuser@example.com');
    assert.ok(lastSentEmail);
    assert.equal(lastSentEmail.to, 'newuser@example.com');
    assert.equal(lastSentEmail.template, 'email_verification');
    assert.match(lastSentEmail.code, /^\d{6}$/);

    // Ensure user was NOT created in User collection yet
    assert.equal(db.users.size, 0);

    // Ensure OTP record was created in AuthOtp
    const otp = db.otps.get('newuser@example.com:email_verification');
    assert.ok(otp);
    assert.ok(otp.codeHash);
  });

  await t.test('POST /api/auth/register: respects 60-second resend cooldown', async () => {
    // Calling register again immediately for the same email
    const res = await makeRequest(server, '/api/auth/register', 'POST', {
      username: 'newuser@example.com',
      password: 'SuperSecurePassword2026!',
      confirmPassword: 'SuperSecurePassword2026!',
    });
    assert.equal(res.status, 429);
    assert.ok(res.data.message.includes('wait a minute'));
  });

  await t.test('POST /api/auth/verify-email: rejects invalid or expired code, locks out after 5 attempts', async () => {
    // 4 failed attempts
    for (let i = 1; i <= 4; i++) {
      const res = await makeRequest(server, '/api/auth/verify-email', 'POST', {
        email: 'newuser@example.com',
        code: '000000',
      });
      assert.equal(res.status, 400);
      assert.ok(res.data.message.includes('invalid or expired'));
      const otp = db.otps.get('newuser@example.com:email_verification');
      assert.equal(otp.attempts, i);
    }

    // 5th failed attempt deletes record
    const res5 = await makeRequest(server, '/api/auth/verify-email', 'POST', {
      email: 'newuser@example.com',
      code: '000000',
    });
    assert.equal(res5.status, 400);
    assert.equal(db.otps.has('newuser@example.com:email_verification'), false);
  });

  await t.test('POST /api/auth/verify-email: successful verification creates user & session', async () => {
    db.clear();
    lastSentEmail = null;

    // Register
    await makeRequest(server, '/api/auth/register', 'POST', {
      username: 'alice@example.com',
      password: 'AliceStrongPassword123!',
      confirmPassword: 'AliceStrongPassword123!',
    });
    const generatedCode = lastSentEmail.code;

    // Verify with correct code
    const res = await makeRequest(server, '/api/auth/verify-email', 'POST', {
      email: 'alice@example.com',
      code: generatedCode,
    });

    assert.equal(res.status, 201);
    assert.equal(res.data.user.username, 'alice@example.com');
    assert.ok(res.data.csrfToken);

    // User is now saved in User collection
    assert.equal(db.users.size, 1);
    const createdUser = Array.from(db.users.values())[0];
    assert.equal(createdUser.username, 'alice@example.com');

    // OTP was consumed and deleted
    assert.equal(db.otps.has('alice@example.com:email_verification'), false);

    // Reusing the same code now fails
    const reuseRes = await makeRequest(server, '/api/auth/verify-email', 'POST', {
      email: 'alice@example.com',
      code: generatedCode,
    });
    assert.equal(reuseRes.status, 400);
  });

  await t.test('POST /api/auth/forgot-password: generic response prevents email enumeration', async () => {
    lastSentEmail = null;

    // Non-existent user
    const resNonExistent = await makeRequest(server, '/api/auth/forgot-password', 'POST', {
      email: 'nonexistent@example.com',
    });
    assert.equal(resNonExistent.status, 200);
    assert.ok(resNonExistent.data.message.includes('If an account exists'));
    assert.equal(lastSentEmail, null); // No email sent for non-existent user

    // Existing user (alice)
    const resExisting = await makeRequest(server, '/api/auth/forgot-password', 'POST', {
      email: 'alice@example.com',
    });
    assert.equal(resExisting.status, 200);
    assert.ok(resExisting.data.message.includes('If an account exists'));
    assert.ok(lastSentEmail);
    assert.equal(lastSentEmail.to, 'alice@example.com');
    assert.equal(lastSentEmail.template, 'password_reset');
    assert.match(lastSentEmail.code, /^\d{6}$/);
  });

  await t.test('POST /api/auth/verify-reset-code: verifies code and issues single-use resetToken', async () => {
    const resetOtp = lastSentEmail.code;

    // Wrong code
    const wrongRes = await makeRequest(server, '/api/auth/verify-reset-code', 'POST', {
      email: 'alice@example.com',
      code: '111111',
    });
    assert.equal(wrongRes.status, 400);

    // Correct code
    const correctRes = await makeRequest(server, '/api/auth/verify-reset-code', 'POST', {
      email: 'alice@example.com',
      code: resetOtp,
    });
    assert.equal(correctRes.status, 200);
    assert.ok(correctRes.data.resetToken);

    const resetToken = correctRes.data.resetToken;

    // Code is now invalidated; attempting to verify the 6-digit code again fails
    const secondTry = await makeRequest(server, '/api/auth/verify-reset-code', 'POST', {
      email: 'alice@example.com',
      code: resetOtp,
    });
    assert.equal(secondTry.status, 400);

    // Reset password with mismatched passwords
    const mismatchRes = await makeRequest(server, '/api/auth/reset-password', 'POST', {
      email: 'alice@example.com',
      resetToken,
      newPassword: 'BrandNewPassword2026!',
      confirmPassword: 'MismatchPassword2026!',
    });
    assert.equal(mismatchRes.status, 400);

    // Successful password reset
    const successRes = await makeRequest(server, '/api/auth/reset-password', 'POST', {
      email: 'alice@example.com',
      resetToken,
      newPassword: 'BrandNewPassword2026!',
      confirmPassword: 'BrandNewPassword2026!',
    });
    assert.equal(successRes.status, 200);
    assert.ok(successRes.data.message.includes('reset successfully'));

    // Reusing the resetToken fails
    const reuseTokenRes = await makeRequest(server, '/api/auth/reset-password', 'POST', {
      email: 'alice@example.com',
      resetToken,
      newPassword: 'AnotherPassword2026!',
      confirmPassword: 'AnotherPassword2026!',
    });
    assert.equal(reuseTokenRes.status, 400);

    // Login with new password works
    const loginRes = await makeRequest(server, '/api/auth/login', 'POST', {
      username: 'alice@example.com',
      password: 'BrandNewPassword2026!',
    });
    assert.equal(loginRes.status, 200);
    assert.equal(loginRes.data.user.username, 'alice@example.com');

    // Login with old password fails
    const oldLoginRes = await makeRequest(server, '/api/auth/login', 'POST', {
      username: 'alice@example.com',
      password: 'AliceStrongPassword123!',
    });
    assert.equal(oldLoginRes.status, 401);
  });
});
