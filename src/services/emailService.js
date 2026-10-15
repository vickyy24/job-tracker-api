/**
 * Email delivery service via Google Apps Script Web App over HTTPS.
 * Render free tier blocks outbound SMTP, so we deliver transactional OTPs
 * via authenticated HTTPS calls to a Google Apps Script relay using Google MailApp.
 */

let mockHandler = null;

function getEmailConfig() {
  const url = process.env.APPS_SCRIPT_URL;
  const secret = process.env.APPS_SCRIPT_SHARED_SECRET;
  return { url, secret };
}

async function sendViaAppsScript({ template, to, code, expiresInMinutes = 10 }) {
  if (mockHandler) {
    return mockHandler({ template, to, code, expiresInMinutes });
  }

  const { url, secret } = getEmailConfig();
  if (!url || !secret) {
    const error = new Error('Email delivery is not configured.');
    error.status = 503;
    error.operation = 'email.config';
    error.publicMessage = 'Email delivery service is currently not configured on the server. Please contact support.';
    throw error;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret,
        action: 'send_email',
        template,
        to,
        code,
        expiresInMinutes,
      }),
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || !data || data.success !== true) {
      const error = new Error('Email service rejected delivery.');
      error.status = 502;
      error.operation = 'email.apps-script-rejection';
      error.code = data?.error || 'DELIVERY_REJECTED';
      error.publicMessage = 'Unable to deliver email at this time. Please try again shortly.';
      throw error;
    }

    return { success: true };
  } catch (cause) {
    if (cause.status) throw cause;

    const error = new Error('Email delivery request failed.');
    error.status = 502;
    error.operation = 'email.apps-script-transport';
    error.code = cause.name === 'TimeoutError' ? 'ETIMEDOUT' : (cause.code || 'TRANSPORT_ERROR');
    error.publicMessage = cause.name === 'TimeoutError'
      ? 'The email service took too long to respond. Please try again shortly.'
      : 'We could not connect to the email delivery service. Please try again in a few moments.';
    throw error;
  }
}

async function sendVerificationEmail(email, code, expiresInMinutes = 10) {
  return sendViaAppsScript({
    template: 'email_verification',
    to: email,
    code,
    expiresInMinutes,
  });
}

async function sendPasswordResetEmail(email, code, expiresInMinutes = 10) {
  return sendViaAppsScript({
    template: 'password_reset',
    to: email,
    code,
    expiresInMinutes,
  });
}

// Mock handler setter for test environments
function _setMockHandler(handler) {
  mockHandler = handler;
}

module.exports = {
  sendVerificationEmail,
  sendVerificationCode: sendVerificationEmail, // alias for backwards compatibility
  sendPasswordResetEmail,
  _setMockHandler,
};
