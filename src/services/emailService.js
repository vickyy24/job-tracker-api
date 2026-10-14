const nodemailer = require('nodemailer');

function createTransport() {
  const { GMAIL_USER, GMAIL_APP_PASSWORD } = process.env;
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    const error = new Error('Email delivery is not configured.');
    error.status = 503;
    error.publicMessage = 'Email delivery is not configured yet. Please try again later.';
    throw error;
  }

  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
}

async function deliverMail(transport, message) {
  try {
    await transport.sendMail(message);
  } catch (cause) {
    const error = new Error('Gmail SMTP delivery failed.');
    error.status = 503;
    error.operation = 'email.gmail-smtp';
    error.code = cause.code || 'SMTP_ERROR';
    error.command = cause.command || null;
    error.responseCode = cause.responseCode || null;
    error.publicMessage = cause.code === 'ETIMEDOUT'
      ? 'The email service could not connect. Please try again later.'
      : 'The email service could not send your message. Please try again later.';
    throw error;
  } finally {
    transport.close();
  }
}

async function sendVerificationCode(email, code) {
  const transport = createTransport();
  await deliverMail(transport, {
    from: { name: 'Jobtrack', address: process.env.GMAIL_USER },
    to: email,
    subject: 'Verify your Jobtrack email',
    text: `Your Jobtrack verification code is ${code}. It expires in 10 minutes. If you did not create this account, you can ignore this email.`,
    html: `<p>Your Jobtrack verification code is:</p><p style="font-size:24px;font-weight:700;letter-spacing:6px">${code}</p><p>This code expires in 10 minutes. If you did not create this account, you can ignore this email.</p>`,
  });
}

async function sendPasswordResetCode(email, code) {
  const transport = createTransport();
  await deliverMail(transport, {
    from: { name: 'Jobtrack', address: process.env.GMAIL_USER },
    to: email,
    subject: 'Reset your Jobtrack password',
    text: `Your Jobtrack password reset code is ${code}. It expires in 10 minutes. If you did not request a password reset, you can ignore this email.`,
    html: `<p>Your Jobtrack password reset code is:</p><p style="font-size:24px;font-weight:700;letter-spacing:6px">${code}</p><p>This code expires in 10 minutes. If you did not request a password reset, you can ignore this email.</p>`,
  });
}

module.exports = { sendPasswordResetCode, sendVerificationCode };
