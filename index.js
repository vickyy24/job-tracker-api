const app = require('./src/app');
const connectDatabase = require('./src/config/database');

const port = Number(process.env.PORT) || 5000;

async function start() {
  try {
    if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 24) {
      throw new Error('ADMIN_PASSWORD must be set to a random value of at least 24 characters.');
    }
    await connectDatabase();
    app.listen(port, () => {
      console.log(`Job Tracker API listening on port ${port}`);
    });
  } catch (error) {
    console.error(`API startup failed: ${error.message}`);
    process.exitCode = 1;
  }
}

start();
