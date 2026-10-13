# Job Tracker API

## Current structure

- `index.js` starts the Express server.
- `src/app.js` configures CORS, JSON parsing, the health endpoint, JSON 404 handling, and centralized errors. It exports an app factory for focused HTTP tests.
- `src/config/database.js` reads `MONGODB_URI` and connects to MongoDB during startup.
- `src/models/JobApplication.js` defines the application fields, status values, and timestamps.
- `test/app.test.js` covers health, configured CORS, JSON parsing, unknown routes, and production error responses using Node's built-in test runner.
- The project uses Node.js CommonJS and keeps its existing package setup.

## Run locally

```powershell
npm install
Copy-Item .env.example .env
npm start
```

Edit `.env` to set `MONGODB_URI` to a reachable local or hosted MongoDB database. The checked-in `.env.example` uses a local development URI and contains no credentials. `.env` and other `.env.*` files are ignored by Git; never commit database credentials. Startup validates the URI and waits for MongoDB before listening. Missing configuration, invalid URIs, and connection failures produce clear messages without printing the URI or credentials.

The API listens on port `5000` by default; set `PORT` to override it. CORS allows `http://localhost:3000` by default; set `FRONTEND_ORIGIN` to the frontend's origin when it runs elsewhere. Application routes are added by later tickets.

Run the middleware tests with:

```sh
npm test
```

## Current API endpoint

- `GET /api/health` → `{ "status": "ok" }`
- `POST /api/applications` creates a record with `companyName`, `jobTitle`, `applicationDate`, `status`, and optional `notes`.

The create endpoint returns the saved application with HTTP 201. Invalid model fields return HTTP 400 with a `message`; unexpected errors return `{ "message": "Internal server error" }`. Unknown paths return `{ "message": "Route not found" }`.
