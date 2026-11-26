/*
 * `npm run migrate` (MongoDB / Mongoose edition) — creates every index declared in src/models (names
 * unchanged), brings every id sequence level with the data and fills missing optional fields with null.
 * Safe to run any number of times; the API also does it on every start.
 */
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '..', '.env') });

import { disconnectDb } from '../src/config/db';
import { ensureMongoIndexes } from '../src/config/mongo-indexes';

ensureMongoIndexes((s) => console.log(`  ✓ ${s}`))
  .then(() => console.log('MongoDB indexes and sequences ready.'))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());
