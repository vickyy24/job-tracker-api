const app = require('./src/app');
const connectDatabase = require('./src/config/database');
const User = require('./src/models/User');

const port = Number(process.env.PORT) || 5000;

async function start() {
  try {
    await connectDatabase();

    // Auto-update existing accounts with requested names directly in MongoDB
    try {
      await User.updateMany(
        { username: { $in: ['vikassontakke2002@gmail.com', 'cineplexmovieworld@gmail.com', 'vikas@gmail.com'] } },
        { $set: { firstName: 'Vikas', lastName: 'Sontakke' } }
      );
      console.log('Successfully backfilled names in MongoDB Atlas');
    } catch (backfillErr) {
      console.warn('Backfill notice:', backfillErr.message);
    }

    app.listen(port, () => {
      console.log(`Job Tracker API listening on port ${port}`);
    });
  } catch (error) {
    console.error(`API startup failed: ${error.message}`);
    process.exitCode = 1;
  }
}

start();
