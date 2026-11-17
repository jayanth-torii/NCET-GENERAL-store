/**
 * Base data needed to run the store: settings, the first admin, counters, units, categories and charge types.
 * Safe to run more than once: existing rows are left as they are.
 */
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '..', '.env') });

import { hash, Algorithm } from '@node-rs/argon2';
import { ChargeAllocation, PrismaClient, Role } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.storeSetting.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });

  const pw = process.env.ADMIN_INITIAL_PASSWORD;
  if (!pw || pw.length < 8) throw new Error('Set ADMIN_INITIAL_PASSWORD (8+ characters) in apps/api/.env before seeding');
  const admin = await prisma.appUser.findUnique({ where: { username: 'admin' } });
  if (!admin) {
    await prisma.appUser.create({
      data: {
        username: 'admin',
        fullName: 'Store Admin',
        role: Role.ADMIN,
        passwordHash: await hash(pw, { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }),
        mustChangePassword: true,
      },
    });
    console.log('Created user "admin". The password must be changed at first login.');
  }

  for (const c of [
    { code: 'C1', name: 'Counter 1' },
    { code: 'C2', name: 'Counter 2' },
    { code: 'C3', name: 'Rush counter (tablet)' },
    { code: 'OF', name: 'Office PC' },
  ]) {
    await prisma.counter.upsert({ where: { code: c.code }, update: {}, create: c });
  }

  for (const u of [
    { code: 'PCS', name: 'Pieces', allowDecimal: false },
    { code: 'BOX', name: 'Box', allowDecimal: false },
    { code: 'PKT', name: 'Packet', allowDecimal: false },
    { code: 'DOZ', name: 'Dozen', allowDecimal: false },
    { code: 'REAM', name: 'Ream', allowDecimal: true },
    { code: 'SET', name: 'Set', allowDecimal: false },
    { code: 'KG', name: 'Kilogram', allowDecimal: true },
  ]) {
    await prisma.unit.upsert({ where: { code: u.code }, update: {}, create: u });
  }

  for (const name of ['Stationery', 'Lab records', 'Exam material', 'Copier paper', 'Snacks', 'Medicines', 'Autonomous exam material', 'Other']) {
    await prisma.category.upsert({ where: { name }, update: {}, create: { name } });
  }

  for (const ct of [
    { name: 'Transport', addsToCost: true, allocation: ChargeAllocation.BY_VALUE },
    { name: 'Loading / Unloading', addsToCost: true, allocation: ChargeAllocation.BY_QTY },
    { name: 'Hamali', addsToCost: true, allocation: ChargeAllocation.BY_QTY },
    { name: 'Courier', addsToCost: true, allocation: ChargeAllocation.BY_VALUE },
    { name: 'Packing', addsToCost: true, allocation: ChargeAllocation.BY_VALUE },
    { name: 'Other (not in cost)', addsToCost: false, allocation: ChargeAllocation.NONE },
  ]) {
    await prisma.chargeType.upsert({ where: { name: ct.name }, update: {}, create: ct });
  }
  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
