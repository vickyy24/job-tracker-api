const mongoose = require('mongoose');

const expectedDatabaseName = 'jobtracker';
const requiredConfirmation = 'DELETE_ALL_JOBTRACK_DATA';

async function resetDatabase() {
  if (process.env.CONFIRM_JOBTRACK_DATABASE_RESET !== requiredConfirmation) {
    throw new Error(`Set CONFIRM_JOBTRACK_DATABASE_RESET=${requiredConfirmation} to continue.`);
  }
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15_000 });
  const database = mongoose.connection.db;
  if (database.databaseName !== expectedDatabaseName) {
    throw new Error(`Refusing to reset database "${database.databaseName}"; expected "${expectedDatabaseName}".`);
  }

  const collections = await database.listCollections({}, { nameOnly: true }).toArray();
  const counts = {};
  for (const { name } of collections) {
    counts[name] = await database.collection(name).countDocuments();
  }
  console.log(JSON.stringify({ database: database.databaseName, deleting: counts }));
  await database.dropDatabase();
  console.log(`Database ${expectedDatabaseName} was cleared.`);
}

resetDatabase()
  .catch((error) => {
    console.error(`Database reset failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
