/**
 * AI Job Tracker - Google Apps Script Email Relay
 *
 * This script runs in Google Apps Script as a Web App.
 * It sends transactional OTP emails for new user verification and password resets
 * using Google's MailApp service, without exposing SMTP or requiring business accounts.
 *
 * Setup:
 * 1. Open https://script.google.com/
 * 2. Create a new project (e.g. "AI Job Tracker Email Relay").
 * 3. Paste this code into Code.gs.
 * 4. In Project Settings -> Script Properties, add:
 *    Property: SHARED_SECRET
 *    Value: <generate a secure random 32+ character string>
 * 5. Click "Deploy" -> "New deployment".
 * 6. Select type: "Web app".
 * 7. Set:
 *    - Description: "AI Job Tracker Relay v1"
 *    - Execute as: "Me (<your-email>@gmail.com)"
 *    - Who has access: "Anyone"
 * 8. Click "Deploy" and authorize the script when prompted by Google.
 * 9. Copy the Web App URL (starts with https://script.google.com/macros/s/.../exec)
 *    and configure APPS_SCRIPT_URL and APPS_SCRIPT_SHARED_SECRET in your backend environment.
 */

function getSharedSecret() {
  var properties = PropertiesService.getScriptProperties();
  return properties.getProperty('SHARED_SECRET') || '';
}

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  return createJsonResponse({
    status: 'active',
    service: 'AI Job Tracker Email Service',
    timestamp: new Date().toISOString()
  });
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return createJsonResponse({ success: false, error: 'Empty request payload' });
    }

    var payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (parseError) {
      return createJsonResponse({ success: false, error: 'Malformed JSON payload' });
    }

    // Authenticate request using configured shared secret
    var configuredSecret = getSharedSecret();
    if (!configuredSecret || payload.secret !== configuredSecret) {
      return createJsonResponse({ success: false, error: 'Unauthorized request' });
    }

    if (payload.action !== 'send_email') {
      return createJsonResponse({ success: false, error: 'Unsupported action' });
    }

    var to = (payload.to || '').trim().toLowerCase();
    var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!to || !emailRegex.test(to) || to.length > 254) {
      return createJsonResponse({ success: false, error: 'Invalid recipient email address' });
    }

    var code = String(payload.code || '').trim();
    if (!/^\d{6}$/.test(code)) {
      return createJsonResponse({ success: false, error: 'Invalid verification code format' });
    }

    var expiresInMinutes = parseInt(payload.expiresInMinutes, 10) || 10;
    var template = payload.template;
    var subject = '';
    var textBody = '';
    var htmlBody = '';

    if (template === 'email_verification') {
      subject = 'Verify your AI Job Tracker email';
      textBody = [
        'AI Job Tracker Email Verification',
        '',
        'Your six-digit verification code is: ' + code,
        '',
        'This code will expire in ' + expiresInMinutes + ' minutes.',
        'Enter this code on the verification page to complete your registration.',
        '',
        'If you did not create an account on AI Job Tracker, you can safely ignore this email.'
      ].join('\n');

      htmlBody = [
        '<!DOCTYPE html>',
        '<html>',
        '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>',
        '<body style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif; background-color: #f6f5f9; margin: 0; padding: 24px; color: #222;">',
        '  <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 520px; background-color: #ffffff; border-radius: 12px; border: 1px solid #e5e3ec; overflow: hidden; box-shadow: 0 4px 14px rgba(0,0,0,0.05);">',
        '    <tr>',
        '      <td style="padding: 28px 32px; background: linear-gradient(135deg, #7651e8, #5f3ac7); color: #ffffff; text-align: left;">',
        '        <h1 style="margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.5px;">AI Job Tracker</h1>',
        '        <p style="margin: 4px 0 0; font-size: 13px; opacity: 0.9;">Secure Account Verification</p>',
        '      </td>',
        '    </tr>',
        '    <tr>',
        '      <td style="padding: 32px 32px 24px;">',
        '        <h2 style="margin: 0 0 12px; font-size: 18px; color: #1e1b2e;">Verify your email address</h2>',
        '        <p style="margin: 0 0 24px; font-size: 14px; line-height: 1.5; color: #5f5b72;">Thank you for registering. Enter the verification code below on the signup screen to verify your email and activate your account:</p>',
        '        <div style="background-color: #f7f5ff; border: 1px solid #e0d7fa; border-radius: 8px; padding: 18px; text-align: center; margin: 0 0 24px;">',
        '          <span style="font-family: monospace, \'SFMono-Regular\', Consolas, Courier; font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #5f3ac7;">' + code + '</span>',
        '        </div>',
        '        <p style="margin: 0 0 16px; font-size: 13px; line-height: 1.5; color: #77758a;">This verification code will expire in <strong>' + expiresInMinutes + ' minutes</strong>.</p>',
        '        <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #9a97a8; border-top: 1px solid #f0edf7; padding-top: 16px;">If you did not request this verification code, please ignore this email. No account will be created without this verification.</p>',
        '      </td>',
        '    </tr>',
        '  </table>',
        '</body>',
        '</html>'
      ].join('\n');

    } else if (template === 'password_reset') {
      subject = 'Reset your AI Job Tracker password';
      textBody = [
        'AI Job Tracker Password Reset',
        '',
        'Your six-digit password reset code is: ' + code,
        '',
        'This code will expire in ' + expiresInMinutes + ' minutes.',
        'This code is specifically for resetting your password. Enter this code to choose a new password.',
        '',
        'If you did not request a password reset, you can safely ignore this email. Your password will remain unchanged.'
      ].join('\n');

      htmlBody = [
        '<!DOCTYPE html>',
        '<html>',
        '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>',
        '<body style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif; background-color: #f6f5f9; margin: 0; padding: 24px; color: #222;">',
        '  <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 520px; background-color: #ffffff; border-radius: 12px; border: 1px solid #e5e3ec; overflow: hidden; box-shadow: 0 4px 14px rgba(0,0,0,0.05);">',
        '    <tr>',
        '      <td style="padding: 28px 32px; background: linear-gradient(135deg, #7651e8, #5f3ac7); color: #ffffff; text-align: left;">',
        '        <h1 style="margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.5px;">AI Job Tracker</h1>',
        '        <p style="margin: 4px 0 0; font-size: 13px; opacity: 0.9;">Password Reset Request</p>',
        '      </td>',
        '    </tr>',
        '    <tr>',
        '      <td style="padding: 32px 32px 24px;">',
        '        <h2 style="margin: 0 0 12px; font-size: 18px; color: #1e1b2e;">Reset your password</h2>',
        '        <p style="margin: 0 0 24px; font-size: 14px; line-height: 1.5; color: #5f5b72;">We received a request to reset your password. Use the six-digit code below to complete the password reset process:</p>',
        '        <div style="background-color: #f7f5ff; border: 1px solid #e0d7fa; border-radius: 8px; padding: 18px; text-align: center; margin: 0 0 24px;">',
        '          <span style="font-family: monospace, \'SFMono-Regular\', Consolas, Courier; font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #5f3ac7;">' + code + '</span>',
        '        </div>',
        '        <p style="margin: 0 0 16px; font-size: 13px; line-height: 1.5; color: #77758a;">This code is valid for <strong>' + expiresInMinutes + ' minutes</strong> and can only be used once.</p>',
        '        <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #9a97a8; border-top: 1px solid #f0edf7; padding-top: 16px;">If you did not request a password reset, you can safely ignore this email. Your existing password will remain unchanged.</p>',
        '      </td>',
        '    </tr>',
        '  </table>',
        '</body>',
        '</html>'
      ].join('\n');

    } else {
      return createJsonResponse({ success: false, error: 'Unknown email template' });
    }

    // Send using Google MailApp
    MailApp.sendEmail({
      to: to,
      subject: subject,
      body: textBody,
      htmlBody: htmlBody,
      name: 'AI Job Tracker'
    });

    return createJsonResponse({
      success: true,
      message: 'Email sent successfully'
    });

  } catch (err) {
    return createJsonResponse({
      success: false,
      error: err.toString()
    });
  }
}
