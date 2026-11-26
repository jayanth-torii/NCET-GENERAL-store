// npm run backup:restore -- [--file <backup>] [--into <database>] [--overwrite-live --yes]
// Restores a backup into another database (default <db>_restored) so it can be checked first.
// Replacing the live database needs both --overwrite-live and --yes, and empties each collection first.
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '..', '.env') });

import { connectDb, DbService, disconnectDb } from '../src/config/db';
import { BackupService, liveDatabaseName, readBackup, restoreInto } from '../src/services/backup/service';

const has = (k: string) => process.argv.includes(k);
const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};

(async () => {
  await connectDb();
  const live = liveDatabaseName();
  const file = arg('--file') ?? new BackupService(new DbService()).latest();
  if (!file) throw new Error('No backup file found (use --file)');
  const overwrite = has('--overwrite-live');
  if (overwrite && !has('--yes')) throw new Error('Refusing to overwrite the live database without --yes');
  const target = overwrite ? live : (arg('--into') ?? `${live}_restored`);
  if (!overwrite && target === live) throw new Error('--into is the live database; use --overwrite-live --yes to replace it');
  const b = readBackup(file);
  console.log(`Restoring ${file}`);
  console.log(`  taken ${b.createdAt} from ${b.database} -> into ${target}${overwrite ? ' (LIVE)' : ''}`);
  await restoreInto(target, b, (s) => console.log(s));
  console.log('Done. Restart the API so id sequences and indexes are re-checked (npm run migrate also does it).');
})()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());
