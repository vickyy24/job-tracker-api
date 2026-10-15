# Job Tracker API

Express and MongoDB API for the Job Tracker frontend. It stores job applications and provides application lists, updates, and dashboard statistics.

The companion React application is maintained in the [job-tracker-app repository](https://github.com/vickyy24/job-tracker-app).

## Requirements

- Node.js (the start scripts use Node's `--env-file-if-exists` option).
- MongoDB Atlas or a reachable MongoDB server.

## Configure and run

From this folder:

```sh
npm install
```

Copy `.env.example` to `.env`, then set `MONGODB_URI` to your database connection string, replace `JWT_SECRET` with a cryptographically random value of at least 32 bytes, and configure Gmail API OAuth credentials. The API sends email through Gmail's HTTPS API, so it works on Render Free, which blocks outbound SMTP ports. Keep all credentials in the API environment; the frontend does not connect directly to MongoDB or receive mail credentials or the JWT signing key. The `.env` file is ignored by Git.

This source revision requires a verified JWT session for all application data endpoints, scopes application operations to the authenticated account, and requires a session-bound CSRF header for writes. A deployed older revision may still expose unowned records; verify the deployed API version before treating production data as private. Existing records without an owner stay hidden from accounts and must be deleted manually before enabling private accounts; there is no automatic migration or first-account claim.

```env
MONGODB_URI=mongodb+srv://USERNAME:PASSWORD@YOUR-CLUSTER.mongodb.net/jobtracker?retryWrites=true&w=majority
PORT=5000
FRONTEND_ORIGIN=http://localhost:3000
JWT_SECRET=generate-a-random-secret-at-least-32-bytes-long
GMAIL_USER=your.full.address@gmail.com
GMAIL_OAUTH_CLIENT_ID=your-google-oauth-client-id
GMAIL_OAUTH_CLIENT_SECRET=your-google-oauth-client-secret
GMAIL_OAUTH_REFRESH_TOKEN=your-google-oauth-refresh-token
```

Start the server:

```sh
npm start
```

The API connects to MongoDB before listening on port `5000`. `npm run dev` runs it in watch mode. The health endpoint is [http://localhost:5000/api/health](http://localhost:5000/api/health).

## Deploy to Render

The included `render.yaml` defines a Node web service. Create a new Render Blueprint from this repository and set its prompted environment variables in Render's dashboard:

- `MONGODB_URI`: MongoDB Atlas connection string. Restrict the Atlas network access list to Render's outbound IP ranges where your Atlas tier supports it.
- `FRONTEND_ORIGIN`: the exact production Vercel origin, for example `https://job-tracker-app.vercel.app` (no trailing slash).
- `JWT_SECRET`: a cryptographically random secret of at least 32 bytes. Keep it in Render's secret environment settings; never commit it or expose it to the frontend.
- `GMAIL_USER`: the full Gmail address that sends verification and password-reset messages.
- `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`, and `GMAIL_OAUTH_REFRESH_TOKEN`: OAuth credentials authorized for the Gmail `gmail.send` scope. Create them in Google Cloud Console with the Gmail API enabled and offline access, then store them only in Render's secret environment settings. Do not use a Gmail password or App Password here.
- `NODE_ENV`: `production` (set by the Blueprint).

Keep all values in Render's secret environment settings. Never commit `.env` or copy the MongoDB URI into Vercel. Render's free instance may sleep when idle; choose a paid instance if always-on response time is required.

## Application data

Each record stores:

- `userId`: required owner reference, assigned only by the API from the authenticated session
- `companyName` and `jobTitle` (required)
- `salary` and `location` (optional strings)
- `applicationDate` (required date)
- `status`: `Applied`, `Interview`, `Offer`, or `Rejected`
- `notes` (optional; useful for job description and application details)
- `createdAt` and `updatedAt` (managed timestamps)

## API endpoints

All application endpoints are under `/api/applications`.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | API and database connection status |
| `POST` | `/api/auth/register` | Create a pending individual account and email a verification code; accepts `firstName`, `lastName`, `email`, and `password` |
| `POST` | `/api/auth/verify-email` | Verify an email with its six-digit, ten-minute code |
| `POST` | `/api/auth/resend-verification` | Send a replacement verification code |
| `POST` | `/api/auth/login` | Verify credentials and start a session for a verified account |
| `GET` | `/api/auth/session` | Read the current account session |
| `GET` | `/api/auth/csrf` | Obtain the session-bound CSRF token |
| `POST` | `/api/auth/refresh` | Rotate the refresh credential and renew the access JWT |
| `POST` | `/api/auth/logout` | Revoke the current session |
| `GET` | `/api/applications` | List records; supports `search`, `status`, `sortBy`, and `order` |
| `GET` | `/api/applications/stats` | Totals and monthly application counts for the dashboard |
| `GET` | `/api/applications/:id` | Read one application |
| `POST` | `/api/applications` | Create an application |
| `PATCH` | `/api/applications/:id` | Update supplied application fields |
| `DELETE` | `/api/applications/:id` | Delete an application |

Registration does not sign the account in. The user must enter the emailed code and then sign in. Verification codes are hashed in MongoDB, expire after ten minutes, allow at most five guesses, and can be resent once per minute. Auth endpoints also apply per-IP request limits stored in MongoDB. Configure Gmail credentials before accepting registrations; they stay on the API server.

Search matches company names and job titles without case sensitivity. List sorting accepts `applicationDate`, `createdAt`, `companyName`, or `jobTitle`, with `asc` or `desc` order. The default is application date descending. On the frontend dashboard, the status breakdown compares all applications with the active pipeline (excluding rejected applications); the monthly activity chart offers the last 6 or 12 calendar months.

Successful list responses have the shape `{ "data": [], "total": 0 }`. Invalid input returns HTTP 400, missing records return HTTP 404, and unexpected errors return a generic HTTP 500 message.

## Tests

```sh
npm test
```

The `npm test` command uses Node's built-in test runner. Add test files under `test/` as API coverage is introduced.
