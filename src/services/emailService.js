const { randomBytes } = require('node:crypto');

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REQUEST_TIMEOUT_MS = 10_000;

function createDeliveryError(operation, code) {
  const error = new Error('Email delivery is temporarily unavailable.');
  error.status = 503;
  error.publicMessage = 'We couldn’t send that email right now. Please try again later.';
  error.operation = operation;
  error.code = code;
  return error;
}

function gmailConfig() {
  const { GMAIL_USER, GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET, GMAIL_OAUTH_REFRESH_TOKEN } = process.env;
  if (!GMAIL_USER || !GMAIL_OAUTH_CLIENT_ID || !GMAIL_OAUTH_CLIENT_SECRET || !GMAIL_OAUTH_REFRESH_TOKEN) {
    const error = createDeliveryError('email.gmail-config', 'MISSING_CONFIG');
    error.publicMessage = 'Email delivery is not configured yet. Please try again later.';
    throw error;
  }
  return { GMAIL_USER, GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET, GMAIL_OAUTH_REFRESH_TOKEN };
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function getAccessToken(config) {
  let response;
  try {
    response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.GMAIL_OAUTH_CLIENT_ID,
        client_secret: config.GMAIL_OAUTH_CLIENT_SECRET,
        refresh_token: config.GMAIL_OAUTH_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    throw createDeliveryError('email.gmail-oauth', cause.code || cause.name || 'NETWORK_ERROR');
  }

  const result = await readJson(response);
  if (!response.ok || typeof result.access_token !== 'string') {
    throw createDeliveryError('email.gmail-oauth', `HTTP_${response.status}`);
  }
  return result.access_token;
}

function encodeMessage({ from, to, subject, text, html }) {
  const boundary = `jobtrack_${randomBytes(18).toString('hex')}`;
  const encodePart = (type, value) => [
    `--${boundary}`,
    `Content-Type: ${type}; charset="UTF-8"`,
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(value, 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n'),
  ].join('\r\n');
  const message = [
    `From: Jobtrack <${from}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    encodePart('text/plain', text),
    encodePart('text/html', html),
    `--${boundary}--`,
    '',
  ].join('\r\n');
  return Buffer.from(message, 'utf8').toString('base64url');
}

async function sendEmail({ to, subject, text, html }) {
  const config = gmailConfig();
  const accessToken = await getAccessToken(config);
  let response;
  try {
    response = await fetch(GMAIL_API_BASE, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: encodeMessage({ from: config.GMAIL_USER, to, subject, text, html }) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    throw createDeliveryError('email.gmail-send', cause.code || cause.name || 'NETWORK_ERROR');
  }
  if (!response.ok) {
    throw createDeliveryError('email.gmail-send', `HTTP_${response.status}`);
  }
}

async function sendVerificationCode(email, code) {
  await sendEmail({
    to: email,
    subject: 'Verify your Jobtrack email',
    text: `Your Jobtrack verification code is ${code}. It expires in 10 minutes. If you did not create this account, you can ignore this email.`,
    html: `<p>Your Jobtrack verification code is:</p><p style="font-size:24px;font-weight:700;letter-spacing:6px">${code}</p><p>This code expires in 10 minutes. If you did not create this account, you can ignore this email.</p>`,
  });
}

async function sendPasswordResetCode(email, code) {
  await sendEmail({
    to: email,
    subject: 'Reset your Jobtrack password',
    text: `Your Jobtrack password reset code is ${code}. It expires in 10 minutes. If you did not request a password reset, you can ignore this email.`,
    html: `<p>Your Jobtrack password reset code is:</p><p style="font-size:24px;font-weight:700;letter-spacing:6px">${code}</p><p>This code expires in 10 minutes. If you did not request a password reset, you can ignore this email.</p>`,
  });
}

module.exports = { sendPasswordResetCode, sendVerificationCode };
