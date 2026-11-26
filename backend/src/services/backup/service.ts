import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EJSON } from 'bson';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'fs';
import mongoose, { Model } from 'mongoose';
import { basename, join } from 'path';
import { gunzipSync, gzipSync } from 'zlib';
import { connectDb, DbService, JsonValue, retryTransient } from '../../config/db';

/**
 * Backups (blueprint NFR-04): nightly copy of every collection, restore tested monthly.
 *
 * - A backup is one gzip file of every collection in canonical Extended JSON, which keeps every stored
 *   type exactly (64-bit ids, doubles, 32-bit ints, dates). With BACKUP_KEY set it is encrypted with
 *   AES-256-GCM (key from scrypt) and the file name ends in .enc.
 * - Written to BACKUP_DIR (default backend/backups), then copied to BACKUP_USB_DIR (any folder, e.g. a USB
 *   disk) and BACKUP_CLOUD_DIR (e.g. a OneDrive / Google Drive folder). The cloud copy is only made when the
 *   file is encrypted.
 * - Each folder keeps the newest backup of each of the last 30 days and of each of the last 12 months.
 * - The restore test loads the newest backup into a scratch database (<db>_restore_test), checks every
 *   collection count and that every number field holds a number, then drops the scratch database.
 *   With `compareLive` it also requires every restored document to equal the live one, type for type.
 * - Version 1 files (relaxed JSON, written before the switch to Mongoose) are still restored: their
 *   numbers get their types back from the Mongoose schemas.
 */

const MAGIC = Buffer.from('NCETBK1');
const FILE_RE = /^(.+)-(\d{4})-(\d{2})-(\d{2})-(\d{4})\.json\.gz(\.enc)?$/;
const BATCH = 500;

type Doc = Record<string, unknown>;
export interface BackupFile {
  format: 'ncet-store-backup';
  version: 1 | 2;
  database: string;
  createdAt: string;
  counts: Record<string, number>;
  collections: Record<string, Doc[]>; // version 2: canonical EJSON documents; version 1: relaxed
}

export interface BackupResult {
  file: string;
  bytes: number;
  encrypted: boolean;
  counts: Record<string, number>;
  copies: string[];
  skipped: string[];
  pruned: string[];
}

export interface RestoreTestResult {
  ok: boolean;
  file: string;
  database: string;
  collections: number;
  documents: number;
  problems: string[];
}

type FieldKind = 'BigInt' | 'Double' | 'Int32';

/** Collection name -> number fields and their stored type, from the Mongoose schemas. */
export function collectionTypes(): Record<string, Record<string, FieldKind>> {
  const out: Record<string, Record<string, FieldKind>> = {};
  for (const name of mongoose.modelNames()) {
    const model = mongoose.model(name) as Model<unknown>;
    const numeric: Record<string, FieldKind> = {};
    model.schema.eachPath((path, type) => {
      if (type.instance === 'BigInt' || type.instance === 'Double' || type.instance === 'Int32') numeric[path] = type.instance;
    });
    out[model.collection.collectionName] = numeric;
  }
  return out;
}

/** Version 1 files: put the schema type back on numbers that relaxed JSON flattened. */
export function retype(doc: Doc, numeric: Record<string, FieldKind>): Doc {
  const out: Doc = { ...doc };
  for (const [key, kind] of Object.entries(numeric)) {
    const v = out[key];
    if (typeof v === 'number' || (typeof v === 'string' && kind === 'BigInt')) {
      if (kind === 'BigInt') out[key] = { $numberLong: String(v) };
      else if (kind === 'Double') out[key] = { $numberDouble: String(v) };
      else out[key] = { $numberInt: String(v) };
    }
  }
  return out;
}

export function encrypt(data: Buffer, passphrase: string): Buffer {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', scryptSync(passphrase, salt, 32), iv);
  const body = Buffer.concat([c.update(data), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), body]);
}

export function decrypt(data: Buffer, passphrase: string): Buffer {
  if (!data.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Not an encrypted NCET store backup');
  let o = MAGIC.length;
  const salt = data.subarray(o, (o += 16));
  const iv = data.subarray(o, (o += 12));
  const tag = data.subarray(o, (o += 16));
  const d = createDecipheriv('aes-256-gcm', scryptSync(passphrase, salt, 32), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data.subarray(o)), d.final()]);
}

export function readBackup(path: string, passphrase = process.env.BACKUP_KEY): BackupFile {
  let raw: Buffer = readFileSync(path);
  if (path.endsWith('.enc')) {
    if (!passphrase) throw new Error('This backup is encrypted: set BACKUP_KEY');
    raw = decrypt(raw, passphrase);
  }
  const b = JSON.parse(gunzipSync(raw).toString('utf8')) as BackupFile;
  if (b.format !== 'ncet-store-backup' || (b.version !== 1 && b.version !== 2)) throw new Error('Not an NCET store backup file');
  return b;
}

/** Documents of a backup collection as native BSON values, ready to insert. */
function documentsOf(b: BackupFile, collection: string): Doc[] {
  const docs = b.collections[collection] ?? [];
  if (b.version === 2) return docs.map((d) => EJSON.deserialize(d, { relaxed: false }) as Doc);
  const numeric = collectionTypes()[collection] ?? {};
  return docs.map((d) => EJSON.deserialize(retype(d, numeric), { relaxed: false }) as Doc);
}

/** Keep the newest file of each of the last `days` days and of each of the last `months` months. */
export function filesToPrune(names: string[], days = 30, months = 12): string[] {
  const backups = names.filter((n) => FILE_RE.test(n)).sort().reverse();
  const keep = new Set<string>();
  const seenDays = new Set<string>();
  const seenMonths = new Set<string>();
  for (const n of backups) {
    const [, , y, m, d] = FILE_RE.exec(n)!;
    if (!seenDays.has(`${y}${m}${d}`) && seenDays.size < days) {
      seenDays.add(`${y}${m}${d}`);
      keep.add(n);
    }
    if (!seenMonths.has(`${y}${m}`) && seenMonths.size < months) {
      seenMonths.add(`${y}${m}`);
      keep.add(n);
    }
  }
  return backups.filter((n) => !keep.has(n));
}

export function backupDir() {
  return process.env.BACKUP_DIR || join(__dirname, '..', '..', '..', 'backups');
}

/** The live database, or another database on the same server (same connection). */
export function database(name?: string) {
  const conn = mongoose.connection;
  return name ? conn.getClient().db(name) : conn.db!;
}
export function liveDatabaseName() {
  return mongoose.connection.db!.databaseName;
}

/** Every document of a collection, in _id order, with stored types kept (no promotion to JS numbers). */
async function dumpCollection(name: string) {
  const coll = database().collection(name);
  const count = () => retryTransient(() => coll.countDocuments(), 6);
  const before = await count();
  const docs = await retryTransient(() => coll.find({}, { sort: { _id: 1 }, promoteValues: false, batchSize: BATCH }).toArray(), 6);
  // A dump with fewer documents than the collection holds is not a backup. Writes during the dump can move
  // the count either way, so compare with the smaller of the counts taken before and after.
  if (docs.length < before && docs.length < (await count())) {
    throw new Error(`Backup of ${name} is incomplete: ${docs.length} documents read, collection has ${before}`);
  }
  return docs.map((d) => EJSON.serialize(d, { relaxed: false }) as Doc);
}

/** Load a backup into a database (live or scratch). Each collection is emptied first. */
export async function restoreInto(dbName: string, b: BackupFile, log: (s: string) => void = () => undefined) {
  const target = database(dbName);
  for (const name of Object.keys(b.collections)) {
    const docs = documentsOf(b, name);
    const coll = target.collection(name);
    await retryTransient(() => coll.deleteMany({}), 6);
    for (let i = 0; i < docs.length; i += BATCH) {
      const batch = docs.slice(i, i + BATCH);
      const ids = batch.map((d) => d._id);
      // delete-then-insert keeps a retried batch from failing on duplicate ids
      await retryTransient(async () => {
        await coll.deleteMany({ _id: { $in: ids as never[] } });
        await coll.insertMany(batch as never[], { ordered: true });
      }, 6);
    }
    log(`  restored ${name}: ${docs.length}`);
  }
}

@Injectable()
export class BackupService {
  private readonly logger = new Logger('Backup');

  constructor(private readonly db: DbService) {}

  private get enabled() {
    return process.env.BACKUP_ENABLED !== '0';
  }

  @Cron('30 1 * * *', { timeZone: 'Asia/Kolkata' })
  async nightly() {
    if (!this.enabled) return;
    try {
      const r = await this.backup();
      this.logger.log(`Nightly backup ${basename(r.file)} (${(r.bytes / 1024).toFixed(0)} KB, ${r.copies.length} copies)`);
      for (const s of r.skipped) this.logger.warn(s);
    } catch (e) {
      await this.alert('BACKUP_FAILED', `Nightly backup failed: ${(e as Error).message}`);
    }
  }

  @Cron('0 3 1 * *', { timeZone: 'Asia/Kolkata' })
  async monthlyRestoreTest() {
    if (!this.enabled) return;
    try {
      const r = await this.restoreTest();
      if (r.ok) this.logger.log(`Monthly restore test passed: ${r.documents} documents in ${r.collections} collections`);
      else await this.alert('RESTORE_TEST_FAILED', `Monthly restore test failed: ${r.problems.slice(0, 3).join('; ')}`, r);
    } catch (e) {
      await this.alert('RESTORE_TEST_FAILED', `Monthly restore test failed: ${(e as Error).message}`);
    }
  }

  private async alert(kind: string, message: string, details?: unknown) {
    this.logger.error(message);
    await this.db.systemAlert
      .create({ data: { kind, message: message.slice(0, 500), details: (details ?? null) as JsonValue } })
      .catch((e) => this.logger.error(`Could not save the alert: ${(e as Error).message}`));
  }

  /** Write a backup of every collection, copy it to the USB / cloud folders, and prune old files. */
  async backup(now = new Date()): Promise<BackupResult> {
    await connectDb();
    const db = database();
    const names = (await retryTransient(() => db.listCollections({}, { nameOnly: true }).toArray(), 6))
      .map((c) => c.name)
      .filter((n) => !n.startsWith('system.'))
      .sort();
    const collections: BackupFile['collections'] = {};
    const counts: Record<string, number> = {};
    for (const n of names) {
      collections[n] = await dumpCollection(n);
      counts[n] = collections[n].length;
    }
    const file: BackupFile = { format: 'ncet-store-backup', version: 2, database: db.databaseName, createdAt: now.toISOString(), counts, collections };
    const key = process.env.BACKUP_KEY;
    let data: Buffer = gzipSync(Buffer.from(JSON.stringify(file)), { level: 9 });
    if (key) data = encrypt(data, key);

    const ist = new Date(now.getTime() + 330 * 60_000).toISOString(); // file names use the store's clock (IST)
    const stamp = `${ist.slice(0, 10)}-${ist.slice(11, 13)}${ist.slice(14, 16)}`;
    const name = `${db.databaseName}-${stamp}.json.gz${key ? '.enc' : ''}`;
    const dir = backupDir();
    mkdirSync(dir, { recursive: true });
    const path = join(dir, name);
    writeFileSync(path, data);

    const copies: string[] = [];
    const skipped: string[] = [];
    const targets: [string, string | undefined][] = [
      ['USB', process.env.BACKUP_USB_DIR],
      ['cloud', process.env.BACKUP_CLOUD_DIR],
    ];
    for (const [label, target] of targets) {
      if (!target) continue;
      if (label === 'cloud' && !key) {
        skipped.push('Cloud copy skipped: set BACKUP_KEY so the copy is encrypted');
        continue;
      }
      try {
        mkdirSync(target, { recursive: true });
        copyFileSync(path, join(target, name));
        copies.push(join(target, name));
      } catch (e) {
        skipped.push(`${label} copy to ${target} failed: ${(e as Error).message}`);
      }
    }
    const pruned: string[] = [];
    for (const d of [dir, ...copies.map((c) => join(c, '..'))]) {
      for (const old of filesToPrune(readdirSync(d))) {
        unlinkSync(join(d, old));
        pruned.push(join(d, old));
      }
    }
    if (skipped.length) await this.alert('BACKUP_COPY', skipped.join('; '));
    return { file: path, bytes: data.length, encrypted: !!key, counts, copies, skipped, pruned };
  }

  /** Newest backup file in BACKUP_DIR, or null. */
  latest(dir = backupDir()): string | null {
    if (!existsSync(dir)) return null;
    const files = readdirSync(dir).filter((n) => FILE_RE.test(n)).sort();
    return files.length ? join(dir, files[files.length - 1]) : null;
  }

  /**
   * Restore the newest backup into a scratch database, check it, then drop the scratch database.
   * `compareLive` also requires every restored document to equal the live one (values and stored types).
   * Only meaningful right after a backup, while nobody is writing.
   */
  async restoreTest(file = this.latest() ?? undefined, log: (s: string) => void = () => undefined, compareLive = false): Promise<RestoreTestResult> {
    await connectDb();
    if (!file) file = (await this.backup()).file;
    const b = readBackup(file);
    const scratch = `${liveDatabaseName()}_restore_test`;
    const target = database(scratch);
    const problems: string[] = [];
    try {
      await retryTransient(() => target.dropDatabase(), 6);
      await restoreInto(scratch, b, log);
      const types = collectionTypes();
      let documents = 0;
      for (const [name, expected] of Object.entries(b.counts)) {
        const n = await retryTransient(() => target.collection(name).countDocuments(), 6);
        documents += n;
        if (n !== expected) problems.push(`${name}: ${n} documents restored, backup has ${expected}`);
        // Every number field must hold a number. (Which numeric type varies: data written by the Prisma
        // edition stores integers as 64-bit and whole-number money as int; MongoDB compares them as equal.)
        for (const field of Object.keys(types[name] ?? {})) {
          const bad = await retryTransient(() => target.collection(name).countDocuments({ [field]: { $exists: true, $ne: null, $not: { $type: 'number' } } }), 6);
          if (bad) problems.push(`${name}.${field}: ${bad} values are not numbers`);
        }
      }
      if (compareLive) {
        let same = 0;
        for (const name of Object.keys(b.counts)) {
          const read = (db: ReturnType<typeof database>) =>
            retryTransient(() => db.collection(name).find({}, { sort: { _id: 1 }, promoteValues: false }).toArray(), 6).then((d) => EJSON.stringify(d, { relaxed: false }));
          const [live, restored] = await Promise.all([read(database()), read(target)]);
          if (live === restored) same++;
          else problems.push(`${name}: restored copy differs from live`);
        }
        log(`  live comparison: ${same}/${Object.keys(b.counts).length} collections identical, type for type`);
      }
      return { ok: problems.length === 0, file, database: scratch, collections: Object.keys(b.counts).length, documents, problems };
    } finally {
      await retryTransient(() => target.dropDatabase(), 6).catch(() => undefined);
    }
  }

  /** Backup files on disk, newest first. */
  list(dir = backupDir()) {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((n) => FILE_RE.test(n))
      .sort()
      .reverse()
      .map((n) => ({ name: n, bytes: statSync(join(dir, n)).size, encrypted: n.endsWith('.enc') }));
  }
}
