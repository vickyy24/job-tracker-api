const mongoose = require('mongoose');

async function connectDatabase() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is required. Set it in the environment or .env file.');
  }

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  } catch {
    throw new Error('Unable to connect to MongoDB. Check MONGODB_URI and database availability.');
  }
}

module.exports = connectDatabase;
