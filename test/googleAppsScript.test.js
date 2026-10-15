const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createAppsScriptEnvironment(configuredSecret = 'valid-test-secret-32-chars-long') {
  let sentEmails = [];

  const context = {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => (key === 'SHARED_SECRET' ? configuredSecret : null),
      }),
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (jsonString) => ({
        setMimeType: () => JSON.parse(jsonString),
      }),
    },
    MailApp: {
      sendEmail: (opts) => {
        sentEmails.push(opts);
      },
    },
    console,
  };

  const scriptCode = fs.readFileSync(
    path.join(__dirname, '../google-apps-script/Code.js'),
    'utf8'
  );

  vm.createContext(context);
  vm.runInContext(scriptCode, context);

  return {
    doGet: context.doGet,
    doPost: context.doPost,
    getSentEmails: () => sentEmails,
  };
}

test('Google Apps Script: doGet returns active service status', () => {
  const env = createAppsScriptEnvironment();
  const result = env.doGet({});
  assert.equal(result.status, 'active');
  assert.equal(result.service, 'AI Job Tracker Email Service');
  assert.ok(result.timestamp);
});

test('Google Apps Script: doPost rejects empty or malformed payload', () => {
  const env = createAppsScriptEnvironment();
  assert.deepEqual(env.doPost(null), { success: false, error: 'Empty request payload' });
  assert.deepEqual(env.doPost({ postData: { contents: '{invalid-json' } }), {
    success: false,
    error: 'Malformed JSON payload',
  });
});

test('Google Apps Script: doPost rejects unauthorized requests', () => {
  const env = createAppsScriptEnvironment('correct-secret');
  const result = env.doPost({
    postData: {
      contents: JSON.stringify({
        secret: 'wrong-secret',
        action: 'send_email',
        template: 'email_verification',
        to: 'user@example.com',
        code: '123456',
      }),
    },
  });
  assert.deepEqual(result, { success: false, error: 'Unauthorized request' });
  assert.equal(env.getSentEmails().length, 0);
});

test('Google Apps Script: doPost validates recipient email and 6-digit code', () => {
  const env = createAppsScriptEnvironment('secret123');
  const invalidEmailResult = env.doPost({
    postData: {
      contents: JSON.stringify({
        secret: 'secret123',
        action: 'send_email',
        template: 'email_verification',
        to: 'not-an-email',
        code: '123456',
      }),
    },
  });
  assert.deepEqual(invalidEmailResult, {
    success: false,
    error: 'Invalid recipient email address',
  });

  const invalidCodeResult = env.doPost({
    postData: {
      contents: JSON.stringify({
        secret: 'secret123',
        action: 'send_email',
        template: 'email_verification',
        to: 'user@example.com',
        code: '1234',
      }),
    },
  });
  assert.deepEqual(invalidCodeResult, {
    success: false,
    error: 'Invalid verification code format',
  });
});

test('Google Apps Script: doPost sends email_verification template', () => {
  const env = createAppsScriptEnvironment('my-secret');
  const result = env.doPost({
    postData: {
      contents: JSON.stringify({
        secret: 'my-secret',
        action: 'send_email',
        template: 'email_verification',
        to: 'newuser@example.com',
        code: '482910',
        expiresInMinutes: 10,
      }),
    },
  });
  assert.deepEqual(result, { success: true, message: 'Email sent successfully' });
  const sent = env.getSentEmails();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'newuser@example.com');
  assert.equal(sent[0].subject, 'Verify your AI Job Tracker email');
  assert.ok(sent[0].body.includes('482910'));
  assert.ok(sent[0].htmlBody.includes('482910'));
  assert.ok(sent[0].body.includes('10 minutes'));
});

test('Google Apps Script: doPost sends password_reset template', () => {
  const env = createAppsScriptEnvironment('my-secret');
  const result = env.doPost({
    postData: {
      contents: JSON.stringify({
        secret: 'my-secret',
        action: 'send_email',
        template: 'password_reset',
        to: 'resetuser@example.com',
        code: '903124',
        expiresInMinutes: 10,
      }),
    },
  });
  assert.deepEqual(result, { success: true, message: 'Email sent successfully' });
  const sent = env.getSentEmails();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'resetuser@example.com');
  assert.equal(sent[0].subject, 'Reset your AI Job Tracker password');
  assert.ok(sent[0].body.includes('903124'));
  assert.ok(sent[0].htmlBody.includes('903124'));
  assert.ok(sent[0].body.includes('specifically for resetting your password'));
});
