const mongoose = require('mongoose');

async function connectDatabase() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is required. Set your MongoDB Atlas connection string in job-tracker-api/.env.');
  }

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  } catch {
    throw new Error('Unable to connect to MongoDB Atlas. Check the connection string, Atlas IP access list, and database user.');
  }
}

module.exports = connectDatabase;
