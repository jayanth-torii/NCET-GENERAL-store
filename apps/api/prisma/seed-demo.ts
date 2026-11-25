/**
 * Training catalogue: the kind of items the NCET campus store sells, with typical MRPs.
 * CHECK EVERY PRICE against the shelf before using this for real; on go-live import the store's own
 * list instead (Products -> Import Excel).
 * Safe to run more than once: items that already exist (same code or same name) are left alone.
 * Products are created with zero stock; post a purchase or load the physical count to give them stock.
 */
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '..', '.env') });

import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';

// The API's client: numeric ids from the _seq sequence, Decimal → number, uniqueness keys (MongoDB edition).
const prisma: PrismaClient = new PrismaService();

// [code or '', name, category, sale price, reorder level, GST %]
const PRODUCTS: [string, string, string, number, number, number][] = [
  // --- chocolates, sweets and snacks
  ['545', '5 STAR Rs10', 'Snacks', 10, 40, 18],
  ['124', '5STAR RS5', 'Snacks', 5, 40, 18],
  ['', 'Dairy Milk Rs10', 'Snacks', 10, 40, 18],
  ['', 'Dairy Milk Rs20', 'Snacks', 20, 30, 18],
  ['', 'Dairy Milk Silk Rs80', 'Snacks', 80, 10, 18],
  ['', 'Dairy Milk Lollipop Rs5', 'Snacks', 5, 50, 18],
  ['', 'KitKat Rs10', 'Snacks', 10, 30, 18],
  ['', 'Munch Rs10', 'Snacks', 10, 30, 18],
  ['', 'Perk Rs10', 'Snacks', 10, 30, 18],
  ['', 'Gems Rs10', 'Snacks', 10, 20, 18],
  ['', 'Eclairs Rs1', 'Snacks', 1, 200, 18],
  ['', 'Melody Rs1', 'Snacks', 1, 200, 18],
  ['', 'Hide & Seek Rs10', 'Snacks', 10, 40, 18],
  ['', 'Hide & Seek Rs30', 'Snacks', 30, 20, 18],
  ['', 'Good Day Cashew Rs10', 'Snacks', 10, 40, 18],
  ['', 'Good Day Butter Rs10', 'Snacks', 10, 40, 18],
  ['', 'Parle-G Rs5', 'Snacks', 5, 60, 18],
  ['', 'Bourbon Rs10', 'Snacks', 10, 30, 18],
  ['', 'Marie Gold Rs10', 'Snacks', 10, 30, 18],
  ['', 'Oreo Rs10', 'Snacks', 10, 30, 18],
  ['', 'Monaco Rs10', 'Snacks', 10, 30, 18],
  ['', 'Lays Classic Salted Rs10', 'Snacks', 10, 40, 12],
  ['', 'Lays Magic Masala Rs10', 'Snacks', 10, 40, 12],
  ['', 'Kurkure Masala Munch Rs10', 'Snacks', 10, 40, 12],
  ['', 'Bingo Mad Angles Rs10', 'Snacks', 10, 30, 12],
  ['', 'Frooti Rs10', 'Snacks', 10, 40, 12],
  ['', 'Maaza Rs10', 'Snacks', 10, 40, 12],
  ['', 'Water Bottle 1 Litre', 'Snacks', 20, 48, 18],
  // --- pens, pencils and small stationery
  ['', 'Reynolds Ball Pen Blue', 'Stationery', 10, 100, 18],
  ['', 'Reynolds Ball Pen Black', 'Stationery', 10, 60, 18],
  ['', 'Reynolds Ball Pen Red', 'Stationery', 10, 30, 18],
  ['', 'Cello Gripper Pen Blue', 'Stationery', 10, 60, 18],
  ['', 'Linc Gel Pen Black', 'Stationery', 10, 40, 18],
  ['', 'Pen Refill Blue', 'Stationery', 5, 60, 18],
  ['29', 'APSARA 28', 'Stationery', 5, 30, 12],
  ['', 'Apsara Platinum Pencil', 'Stationery', 5, 60, 12],
  ['', 'Nataraj Pencil', 'Stationery', 5, 60, 12],
  ['46', 'ABSOLUTE PENCIL', 'Stationery', 5, 30, 12],
  ['56', 'APSARA ERASER', 'Stationery', 5, 30, 12],
  ['26', 'APSARA SHARPENER', 'Stationery', 5, 30, 12],
  ['', 'Highlighter Yellow', 'Stationery', 25, 20, 18],
  ['', 'Whitener Pen', 'Stationery', 30, 20, 18],
  ['', 'Permanent Marker Black', 'Stationery', 25, 20, 18],
  ['', 'Glue Stick', 'Stationery', 15, 20, 18],
  ['', 'Sticky Notes 3x3', 'Stationery', 30, 15, 18],
  ['', 'Stapler No.10', 'Stationery', 60, 5, 18],
  ['', 'Stapler Pins No.10', 'Stationery', 10, 30, 18],
  ['', '30 cm Scale', 'Stationery', 10, 30, 12],
  ['', 'Geometry Box', 'Stationery', 120, 10, 12],
  ['299', '991 ES CALCULATOR', 'Stationery', 1250, 3, 18],
  ['635', 'A5 CLOTH COVER', 'Stationery', 20, 20, 12],
  ['', 'File Folder', 'Stationery', 20, 30, 12],
  // --- books
  ['123', 'NOTE BOOK 200 PAGE RULED', 'Stationery', 35, 50, 0],
  ['', 'Classmate Notebook 172 Pages', 'Stationery', 45, 50, 0],
  ['', 'Long Book 200 Pages', 'Stationery', 60, 40, 0],
  ['', 'Drawing Book', 'Stationery', 30, 20, 0],
  // --- lab records and exam material
  ['562', 'LAB RECORD PHYSICS', 'Lab records', 120, 30, 0],
  ['563', 'LAB RECORD CHEMISTRY', 'Lab records', 120, 30, 0],
  ['', 'Lab Record Electronics', 'Lab records', 120, 30, 0],
  ['', 'Lab Record Computer Science', 'Lab records', 120, 30, 0],
  ['', 'Lab Record Workshop', 'Lab records', 120, 20, 0],
  ['', 'Observation Book', 'Lab records', 60, 40, 0],
  ['561', 'BLUE BOOK THEORY', 'Exam material', 10, 300, 0],
  ['', 'Additional Answer Sheet', 'Exam material', 2, 500, 0],
  ['', 'Graph Sheet', 'Exam material', 2, 300, 0],
  ['', 'Drawing Sheet A2', 'Exam material', 10, 100, 12],
  // --- paper
  ['47', 'A4 SHEET', 'Copier paper', 1, 500, 12],
  ['653', 'A4 COLOUR SHEETS', 'Copier paper', 2, 200, 12],
  ['', 'A4 Paper Ream 500 Sheets', 'Copier paper', 350, 5, 12],
  ['', 'Chart Paper', 'Copier paper', 10, 50, 12],
  // --- medicines and first aid
  ['70', 'AMRUTHANJAN 9.5G', 'Medicines', 30, 10, 12],
  ['', 'Paracetamol 500 Tablet Strip', 'Medicines', 20, 10, 12],
  ['', 'Band Aid Strip', 'Medicines', 2, 100, 12],
  ['', 'Vicks Vaporub 5ml', 'Medicines', 20, 10, 12],
  ['', 'ORS Sachet', 'Medicines', 20, 20, 12],
];

async function main() {
  const pcs = await prisma.unit.findUniqueOrThrow({ where: { code: 'PCS' } });
  const cats = new Map((await prisma.category.findMany()).map((c) => [c.name, c.id]));
  let created = 0;
  for (const [wantCode, name, cat, price, reorder, gst] of PRODUCTS) {
    const exists = await prisma.product.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, isActive: true } });
    if (exists) continue;
    let code = wantCode;
    if (!code || (await prisma.product.findUnique({ where: { code } }))) {
      // Highest all-digit code + 1 (MongoDB has no numeric cast in a filter; the list is small).
      const all = await prisma.product.findMany({ select: { code: true } });
      code = String(all.reduce((m, x) => (/^[0-9]{1,12}$/.test(x.code) ? Math.max(m, Number(x.code)) : m), 0) + 1);
    }
    const categoryId = cats.get(cat) ?? cats.get('Other')!;
    const p = await prisma.product.create({ data: { code, name, categoryId, unitId: pcs.id, salePrice: price, mrp: price, reorderLevel: reorder, gstRate: gst } });
    await prisma.productStock.create({ data: { productId: p.id, onHand: 0 } });
    created++;
  }
  for (const name of ['KC Distributors', 'Sunrise Stationers', 'TLS Paper Products', 'Nagaratna Printers', 'N F Comforts']) {
    await prisma.supplier.upsert({ where: { name }, update: {}, create: { name } });
  }
  const physics = await prisma.product.findFirst({ where: { name: 'LAB RECORD PHYSICS' } });
  const pencil = await prisma.product.findFirst({ where: { name: 'Apsara Platinum Pencil' } });
  if (physics && pencil && !(await prisma.kit.findUnique({ where: { code: 'PHY-REC' } }))) {
    await prisma.kit.create({
      data: { code: 'PHY-REC', name: 'Physics lab record kit', price: 125, items: { create: [{ productId: physics.id, qty: 1 }, { productId: pencil.id, qty: 1 }] } },
    });
  }
  console.log(`Catalogue ready: ${created} new products. Check every price before real use. Stock is zero until you post a purchase.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
