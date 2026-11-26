// npm run backup — write a backup now (same as the nightly 01:30 job). See src/services/backup/service.ts.
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '..', '.env') });

import { DbService, disconnectDb } from '../src/config/db';
import { BackupService } from '../src/services/backup/service';

(async () => {
  const prisma = new DbService();
  try {
    const r = await new BackupService(prisma).backup();
    const docs = Object.values(r.counts).reduce((a, b) => a + b, 0);
    console.log(`Backup written: ${r.file}`);
    console.log(`  ${Object.keys(r.counts).length} collections, ${docs} documents, ${(r.bytes / 1024).toFixed(0)} KB, ${r.encrypted ? 'encrypted' : 'NOT encrypted (set BACKUP_KEY)'}`);
    for (const c of r.copies) console.log(`  copied to ${c}`);
    for (const s of r.skipped) console.log(`  ${s}`);
    for (const p of r.pruned) console.log(`  removed old backup ${p}`);
  } finally {
    await disconnectDb();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
