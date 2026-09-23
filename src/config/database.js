import { MongoClient } from 'mongodb';
import 'dotenv/config';

const isHosted = Boolean(process.env.RENDER || process.env.VERCEL || process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME);
const configuredUri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGO_URL || process.env.DATABASE_URL || '';
const mongoUri = String(configuredUri).trim().replace(/^['"]|['"]$/g, '') || (isHosted ? '' : 'mongodb://127.0.0.1:27017');
const databaseName = process.env.MONGODB_DB || 'ranniti5';
let lastDatabaseError = '';

export const databaseStatus = () => ({
  configured: Boolean(mongoUri),
  connected: Boolean(database),
  error: lastDatabaseError,
});

export const databaseErrorMessage = (error) => {
  const text = String(error?.message || error || lastDatabaseError || '');
  if (!mongoUri) return 'Database is not configured. In Render, add MONGODB_URI and MONGODB_DB, then redeploy.';
  if (/authentication failed|bad auth/i.test(text)) return 'MongoDB rejected the username or password in MONGODB_URI. If the password contains @, :, / or #, URL-encode it.';
  if (/ENOTFOUND|ECONNREFUSED|timed out|ServerSelection|MongoNetwork|querySrv|EAI_AGAIN/i.test(text)) return 'Cannot reach MongoDB. In Atlas Network Access, allow 0.0.0.0/0, then check MONGODB_URI.';
  if (/E11000|duplicate key/i.test(text)) return 'This email is already registered. Sign in with the password you used before.';
  return text || 'Database error. Check the Render logs and MONGODB_URI.';
};
let client;
let database;
let connecting;

export const connectDatabase = async () => {
  if (database) return database;
  if (!mongoUri) {
    throw new Error('Database is not configured. Set MONGODB_URI in the hosting environment.');
  }
  if (!connecting) {
    connecting = MongoClient.connect(mongoUri, { serverSelectionTimeoutMS: 10000, family: 4 }).then((connectedClient) => {
      client = connectedClient;
      database = client.db(databaseName);
      lastDatabaseError = '';
      return database;
    }).catch((error) => {
      connecting = undefined;
      lastDatabaseError = error.message;
      throw error;
    });
  }
  return connecting;
};

export const collection = async (name) => (await connectDatabase()).collection(name);

export const initializeDatabase = async () => {
  if (!mongoUri) {
    console.warn('MONGODB_URI is not set. Serving the site without database features.');
    return;
  }
  const db = await connectDatabase();
  await Promise.all([
    db.collection('users').createIndex({ email: 1 }, { unique: true }),
    db.collection('registrations').createIndex({ id: 1 }, { unique: true }),
    db.collection('payments').createIndex({ registration_id: 1 }, { unique: true }),
    db.collection('invoices').createIndex({ registration_id: 1 }, { unique: true }),
    db.collection('invoices').createIndex({ invoice_number: 1 }, { unique: true }),
    db.collection('entry_passes').createIndex({ registration_id: 1 }, { unique: true }),
    db.collection('entry_passes').createIndex({ pass_number: 1 }, { unique: true }),
    db.collection('entry_passes').createIndex({ qr_token: 1 }, { unique: true }),
    db.collection('checkins').createIndex({ registration_id: 1 }, { unique: true }),
  ]);
  await db.collection('sequences').updateOne({ name: 'invoice' }, { $setOnInsert: { value: 0 } }, { upsert: true });
  await db.collection('sequences').updateOne({ name: 'entry_pass' }, { $setOnInsert: { value: 0 } }, { upsert: true });
  console.log(`Connected to MongoDB database ${databaseName}`);
};

export const nextSequence = async (name) => {
  const result = await (await collection('sequences')).findOneAndUpdate(
    { name }, { $inc: { value: 1 } }, { upsert: true, returnDocument: 'after' },
  );
  return result.value;
};

export const closeDatabase = async () => client?.close();
