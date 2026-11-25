/*
 * `npm run migrate` (MongoDB edition), step 2 of 2 — after `prisma db push` has created the collections
 * and the indexes Prisma knows about, this adds the partial unique indexes and brings every id sequence
 * level with the data. Safe to run any number of times.
 */
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '..', '.env') });

import { PrismaClient } from '@prisma/client';
import { ensureMongoIndexes } from '../src/prisma/mongo-indexes';

const prisma = new PrismaClient();

ensureMongoIndexes(prisma, (s) => console.log(`  ✓ ${s}`))
  .then(() => console.log('MongoDB indexes and sequences ready.'))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
