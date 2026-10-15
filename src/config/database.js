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
  } catch (error) {
    // Keep the underlying Atlas/Mongoose cause visible so local startup failures
    // can be diagnosed instead of collapsing DNS, auth, network, and index
    // errors into the same message. Strip credentials if a driver error happens
    // to include a MongoDB URI.
    const cause = error?.message?.replace(/(mongodb(?:\+srv)?:\/\/)[^\s@]+@/gi, '$1[REDACTED]@');
    throw new Error(`Unable to initialize MongoDB Atlas: ${cause || 'unknown MongoDB error'}`, { cause: error });
  }
}

module.exports = connectDatabase;
