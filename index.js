const app = require('./src/app');
const connectDatabase = require('./src/config/database');

const port = Number(process.env.PORT) || 5000;

async function start() {
  try {
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
