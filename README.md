# Job Tracker API

## Current structure

- `index.js` starts the Express server.
- `src/app.js` configures CORS, JSON parsing, the health endpoint, JSON 404 handling, and centralized errors. It exports an app factory for focused HTTP tests.
- `src/config/database.js` reads `MONGODB_URI` and connects to MongoDB during startup.
- `src/models/JobApplication.js` defines the application fields, status values, and timestamps.
- `test/app.test.js` covers health, configured CORS, JSON parsing, unknown routes, and production error responses using Node's built-in test runner.
- The project uses Node.js CommonJS and keeps its existing package setup.

## Configure MongoDB Atlas and Compass

```powershell
npm install
Copy-Item .env.example .env
```

Set `MONGODB_URI` in `job-tracker-api/.env` to the connection string from your Atlas cluster. Use the database name `jobtracker` in the URI, and keep the username/password only in this backend `.env` file. `.env` is ignored by Git. Never put this URI in the React app or commit it.

In MongoDB Compass, choose **Add new connection**, paste the same Atlas connection string, then connect. The `jobtracker` database and collections appear after the backend successfully saves the first application.

Start the API from this folder with `npm start`. It connects to MongoDB before listening on port `5000`; missing or unreachable Atlas configuration produces an actionable startup error. The API does not fall back to a local MongoDB server. Set `FRONTEND_ORIGIN` when the frontend runs at a different origin.

Start the React app separately from `job-tracker-app` with `npm start`. It calls the Express API and never connects to MongoDB directly.

The API listens on port `5000` by default; set `PORT` to override it. CORS allows `http://localhost:3000` by default. Application routes are available under `/api/applications`.

Run the middleware tests with:

```sh
npm test
```

## Current API endpoint

- `GET /api/health` → `{ "status": "ok" }`
- `GET /api/applications` lists records as `{ "data": [], "total": 0 }`; supports `search`, `status`, `sortBy`, and `order` query parameters.
- `GET /api/applications/stats` returns totals for applications, interviews, offers, and rejections.
- `GET /api/applications/:id` reads one application; `PATCH /api/applications/:id` updates supplied application fields.
- `DELETE /api/applications/:id` deletes one application.
- `POST /api/applications` creates a record with `companyName`, `jobTitle`, `applicationDate`, `status`, and optional `notes`.

Search checks company and job title without case sensitivity. Sorting supports `applicationDate` or `companyName`, ascending or descending; the default is application date descending. Invalid query values return HTTP 400. The create endpoint returns the saved application with HTTP 201. Invalid model fields return HTTP 400 with a `message`; unexpected errors return `{ "message": "Internal server error" }`. Unknown paths return `{ "message": "Route not found" }`.
