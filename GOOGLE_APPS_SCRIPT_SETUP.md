# Google Apps Script Email Relay Setup Guide

This guide explains how to set up and deploy the Google Apps Script Web App email relay for **AI Job Tracker**.

Because Render's free tier blocks outbound SMTP ports (25, 465, 587), our Express backend makes outbound HTTPS API requests to a lightweight Google Apps Script Web App, which sends emails using Google's `MailApp` service from your personal Google account.

---

## Prerequisites

- A standard personal Google Account (`@gmail.com`).
- No credit card, paid Google Cloud account, or company registration is required.
- Free consumer quota: Up to 100 email recipients per day.

---

## Step 1: Create the Google Apps Script Project

1. Open your browser and navigate to [https://script.google.com/](https://script.google.com/).
2. Make sure you are signed in with the personal Google account you want to send emails from.
3. Click the **+ New project** button (top-left).
4. Click on **Untitled project** at the top-left and rename it to:
   ```text
   AI Job Tracker Email Relay
   ```

---

## Step 2: Add the Script Code

1. In the Apps Script code editor, delete any starter code in the `Code.gs` file.
2. Copy the entire contents of [`google-apps-script/Code.js`](./google-apps-script/Code.js) and paste it into `Code.gs`.
3. Press **Ctrl + S** (or **Cmd + S** on Mac) or click the floppy disk icon to save the project.

---

## Step 3: Configure the Shared Secret in Script Properties

To prevent unauthorized parties from using your script endpoint as an open relay, configure a shared secret:

1. Generate a secure random string of at least 32 characters (e.g. run `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` in your terminal).
2. In the Apps Script editor, click the gear icon (**Project Settings**) in the left sidebar navigation.
3. Scroll down to the **Script Properties** section.
4. Click **Add script property**.
5. Set:
   - **Property**: `SHARED_SECRET`
   - **Value**: `<paste your generated 32+ character secret>`
6. Click **Save script properties**.

---

## Step 4: Deploy as a Web App

1. In the upper-right corner of the Apps Script editor, click the blue **Deploy** button and select **New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Fill in the deployment configuration:
   - **Description**: `AI Job Tracker Email Relay v1`
   - **Execute as**: `Me (<your-email>@gmail.com)` *(Crucial: This ensures the script sends emails from your account without asking your users for Google OAuth permissions)*
   - **Who has access**: `Anyone` *(Crucial: This allows your Render backend to make HTTPS requests to the script)*
4. Click **Deploy**.

---

## Step 5: Authorize the Script

1. A popup will appear asking for authorization: **Authorization required**.
2. Click **Authorize access**.
3. Choose your Google account.
4. If Google displays an **"Google hasn't verified this app"** screen (standard for personal Apps Script projects):
   - Click **Advanced** (at the bottom-left of the modal).
   - Click **Go to AI Job Tracker Email Relay (unsafe)**.
5. Review the permissions (it will ask for permission to "Send email as you").
6. Click **Allow**.

---

## Step 6: Copy the Web App URL

1. After deployment completes, copy the **Web app URL**.
   It looks like:
   ```text
   https://script.google.com/macros/s/AKfycb.../exec
   ```
2. Note: Ensure the URL ends in `/exec`, not `/edit`.

---

## Step 7: Configure Environment Variables in Render & Local `.env`

### On Render (Production API Web Service)
In your Render Dashboard -> Your `job-tracker-api` service -> **Environment**:
1. Add `APPS_SCRIPT_URL`: `<your-copied-web-app-url>`
2. Add `APPS_SCRIPT_SHARED_SECRET`: `<the-exact-secret-configured-in-script-properties>`
3. Remove old `GMAIL_USER` and `GMAIL_APP_PASSWORD` variables if present.
4. Save changes (Render will trigger a new deployment with the updated variables).

### In Local Development (`job-tracker-api/.env`)
Add the following to your `.env` file:
```env
APPS_SCRIPT_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
APPS_SCRIPT_SHARED_SECRET=your-secure-random-secret
```

---

## Verification & Testing

### 1. Test Endpoint Availability
You can test GET requests to the deployment URL in a browser or with curl:
```bash
curl -L "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec"
```
It should return:
```json
{"status":"active","service":"AI Job Tracker Email Service","timestamp":"..."}
```

### 2. Note on Email Delivery
- Apps Script sends emails through Google's standard mail servers.
- While emails are typically delivered within seconds, acceptance by Google does not guarantee inbox delivery; emails can land in the **Spam** / **Junk** folder during testing.
- Check your Spam folder if an email does not appear immediately in your Inbox.
