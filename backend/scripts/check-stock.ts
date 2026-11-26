/*
 * `npm run check:stock` — the nightly ledger check, on demand: every product's cached balance must equal
 * the sum of its stock ledger. Exits with code 1 if any product drifts (a dashboard alert is raised too).
 * (The script this command pointed at was missing in the original repository.)
 */
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '..', '.env') });

import { Logger } from '@nestjs/common';
import { StockCheckService } from '../src/services/stockCheck/service';
import { DbService, disconnectDb } from '../src/config/db';

const prisma = new DbService();
new StockCheckService(prisma)
  .run()
  .then((r) => {
    if (r.ok) Logger.log('Every product balance matches its ledger.', 'check:stock');
    else {
      for (const d of r.drift) Logger.error(`${d.code} ${d.name}: balance ${d.cached}, ledger ${d.ledger}`, 'check:stock');
      process.exitCode = 1;
    }
  })
  .catch((e) => {
    Logger.error(e, 'check:stock');
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());
