const mongoose = require('mongoose');
const User = require('../models/User');

async function connectDatabase() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is required. Set your MongoDB Atlas connection string in job-tracker-api/.env.');
  }

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    const usersCollectionExists = await mongoose.connection.db.listCollections({ name: 'users' }, { nameOnly: true }).hasNext();
    if (usersCollectionExists) {
      const indexes = await User.collection.indexes();
      const legacyEmailIndex = indexes.find((index) => index.unique && index.key?.email === 1);
      if (legacyEmailIndex) await User.collection.dropIndex(legacyEmailIndex.name);
    }
    await User.init();
  } catch {
    throw new Error('Unable to initialize MongoDB Atlas. Check the connection string, Atlas IP access list, database user, and user indexes.');
  }
}

module.exports = connectDatabase;
