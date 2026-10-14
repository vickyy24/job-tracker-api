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

Copy `.env.example` to `.env`, then set `MONGODB_URI` to your database connection string. Keep this secret in the API folder; the frontend does not connect directly to MongoDB. The `.env` file is ignored by Git.

```env
MONGODB_URI=mongodb+srv://USERNAME:PASSWORD@YOUR-CLUSTER.mongodb.net/jobtracker?retryWrites=true&w=majority
PORT=5000
FRONTEND_ORIGIN=http://localhost:3000
```

Start the server:

```sh
npm start
```

The API connects to MongoDB before listening on port `5000`. `npm run dev` runs it in watch mode. The health endpoint is [http://localhost:5000/api/health](http://localhost:5000/api/health).

## Application data

Each record stores:

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
| `GET` | `/api/applications` | List records; supports `search`, `status`, `sortBy`, and `order` |
| `GET` | `/api/applications/stats` | Totals and monthly application counts for the dashboard |
| `GET` | `/api/applications/:id` | Read one application |
| `POST` | `/api/applications` | Create an application |
| `PATCH` | `/api/applications/:id` | Update supplied application fields |
| `DELETE` | `/api/applications/:id` | Delete an application |

Search matches company names and job titles without case sensitivity. List sorting accepts `applicationDate`, `createdAt`, `companyName`, or `jobTitle`, with `asc` or `desc` order. The default is application date descending. On the frontend dashboard, the status breakdown compares all applications with the active pipeline (excluding rejected applications); the monthly activity chart offers the last 6 or 12 calendar months.

Successful list responses have the shape `{ "data": [], "total": 0 }`. Invalid input returns HTTP 400, missing records return HTTP 404, and unexpected errors return a generic HTTP 500 message.

## Optional chart demo data

To populate charts with five fictional sample applications dated May through September 2026, run:

```sh
npm run seed:demo
```

The script is safe to run more than once: it skips sample company names already in the database. It dates each sample's `createdAt` with its application date, so demo records do not increase today's daily-goal count. The company names start with `Demo ·` and notes identify each entry as sample data. To remove them, delete records with company names starting with `Demo ·` in the app or your MongoDB client.

The sample records contain company, role, salary, location, application date, status, and a note. Their months and statuses are: May — Applied; June — Interview; July — Rejected; August — Offer; September — Interview. This produces visible month-to-month activity and multiple status totals in the dashboard. The records are fictional and do not represent current job listings.

## Tests

```sh
npm test
```

The `npm test` command uses Node's built-in test runner. Add test files under `test/` as API coverage is introduced.
