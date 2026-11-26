// npm run backup:test [-- --file <backup>] [--compare-live] — restore the newest backup into <db>_restore_test, check it, drop it.
// The API runs the same test on the 1st of every month at 03:00 and raises a dashboard alert if it fails.
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '..', '.env') });

import { DbService, disconnectDb } from '../src/config/db';
import { BackupService } from '../src/services/backup/service';

const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};

(async () => {
  const prisma = new DbService();
  try {
    const svc = new BackupService(prisma);
    const file = arg('--file') ?? svc.latest() ?? undefined;
    console.log(`Restore test of ${file ?? '(no backup yet: making one first)'}`);
    const r = await svc.restoreTest(file, (s) => console.log(s), process.argv.includes('--compare-live'));
    console.log(`${r.ok ? 'PASSED' : 'FAILED'}: ${r.documents} documents in ${r.collections} collections restored into ${r.database} (now dropped)`);
    for (const p of r.problems) console.log(`  problem: ${p}`);
    if (!r.ok) process.exitCode = 1;
  } finally {
    await disconnectDb();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
