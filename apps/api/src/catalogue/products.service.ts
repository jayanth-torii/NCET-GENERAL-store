import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MovementKind, Prisma, Role } from '@prisma/client';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { SessionUser } from '../auth/auth.decorators';
import { AuditService } from '../common/audit.service';
import { D } from '../common/money';
import { SettingsService } from '../common/settings.service';
import { applyMovements } from '../common/stock-ledger';
import { zGst, zMoney, zOptText, zQty, zRate4 } from '../common/validate';
import { PrismaService } from '../prisma/prisma.service';

export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}
export function nameKey(name: string): string {
  return normalizeName(name).toLowerCase();
}

export const ProductInput = z
  .object({
    code: z.string().trim().max(30).regex(/^[A-Za-z0-9\-_.]*$/, 'can use letters, digits, - _ . only').optional().nullable(),
    barcode: z.string().trim().max(64).regex(/^[A-Za-z0-9\-]*$/, 'can use letters, digits and - only').optional().nullable(),
    name: z.string().trim().min(2, 'Name is too short').max(120),
    categoryId: z.coerce.number().int().positive('Choose a category'),
    unitId: z.coerce.number().int().positive('Choose a unit'),
    packUnitId: z.coerce.number().int().positive().optional().nullable(),
    packSize: zQty.default(1),
    hsnCode: z.string().trim().max(10).regex(/^\d*$/, 'HSN must be digits').optional().nullable(),
    gstRate: zGst.default(0),
    mrp: zMoney.optional().nullable(),
    salePrice: zMoney,
    reorderLevel: z.coerce.number().min(0).max(9_999_999).default(0),
    rackNo: zOptText(30),
    openingQty: z.coerce.number().min(0).max(9_999_999).optional(),
    openingCost: zRate4.optional(),
  })
  .refine((p) => p.mrp === null || p.mrp === undefined || p.salePrice <= p.mrp, {
    message: 'Sale price cannot be more than the MRP',
    path: ['salePrice'],
  })
  .refine((p) => !p.packUnitId || p.packSize > 1 || p.packUnitId === p.unitId, {
    message: 'Pack size must be more than 1 when a pack unit is set',
    path: ['packSize'],
  });
export type ProductInputT = z.infer<typeof ProductInput>;

const PRICE_FIELDS = ['salePrice', 'mrp'] as const;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  private async assertNameFree(name: string, exceptId?: number) {
    const rows = await this.prisma.$queryRaw<{ id: number; code: string; name: string }[]>`
      SELECT id, code, name FROM product
      WHERE is_active AND lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) = ${nameKey(name)}
      ${exceptId ? Prisma.sql`AND id <> ${exceptId}` : Prisma.empty}
      LIMIT 1`;
    if (rows.length) {
      throw new ConflictException({ message: `"${rows[0].name}" already exists as product code ${rows[0].code}`, code: 'DUPLICATE_NAME', existingId: rows[0].id });
    }
  }

  private async assertRefs(p: { categoryId: number; unitId: number; packUnitId?: number | null }) {
    const [cat, unit, pack] = await Promise.all([
      this.prisma.category.findUnique({ where: { id: p.categoryId } }),
      this.prisma.unit.findUnique({ where: { id: p.unitId } }),
      p.packUnitId ? this.prisma.unit.findUnique({ where: { id: p.packUnitId } }) : Promise.resolve(true),
    ]);
    if (!cat) throw new BadRequestException('Category does not exist');
    if (!unit) throw new BadRequestException('Unit does not exist');
    if (!pack) throw new BadRequestException('Pack unit does not exist');
    return unit;
  }

  private async nextCode(tx: Prisma.TransactionClient): Promise<string> {
    const rows = await tx.$queryRaw<{ max: number | null }[]>`
      SELECT max(code::bigint) AS max FROM product WHERE code ~ '^[0-9]{1,12}$'`;
    return String(Number(rows[0]?.max ?? 0) + 1);
  }

  async create(input: ProductInputT, user: SessionUser) {
    const name = normalizeName(input.name);
    await this.assertNameFree(name);
    const unit = await this.assertRefs(input);
    const hasOpening = (input.openingQty ?? 0) > 0;
    if (hasOpening && !([Role.ADMIN, Role.MANAGER] as Role[]).includes(user.role)) {
      throw new ForbiddenException('Only a manager can enter opening stock');
    }
    if (hasOpening && !unit.allowDecimal && !Number.isInteger(input.openingQty)) {
      throw new BadRequestException(`Opening stock must be a whole number of ${unit.code}`);
    }
    const settings = await this.settings.get();
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const code = input.code?.trim() || (await this.nextCode(tx));
          const product = await tx.product.create({
            data: {
              code,
              barcode: input.barcode?.trim() || null,
              name,
              categoryId: input.categoryId,
              unitId: input.unitId,
              packUnitId: input.packUnitId ?? null,
              packSize: D(input.packSize),
              hsnCode: input.hsnCode?.trim() || null,
              gstRate: D(input.gstRate),
              mrp: input.mrp === null || input.mrp === undefined ? null : D(input.mrp),
              salePrice: D(input.salePrice),
              lastCost: input.openingCost !== undefined ? D(input.openingCost) : null,
              reorderLevel: D(input.reorderLevel),
              rackNo: input.rackNo ?? null,
            },
          });
          await tx.productStock.create({ data: { productId: product.id, onHand: 0 } });
          if (hasOpening) {
            await applyMovements(
              tx,
              [{ productId: product.id, kind: MovementKind.OPENING, qty: D(input.openingQty!), unitCost: input.openingCost !== undefined ? D(input.openingCost) : null, refType: 'OPENING', refId: product.id, note: 'Opening stock on product creation' }],
              user.id,
              { blockNegative: settings.blockNegativeStock },
            );
          }
          await this.audit.log({ userId: user.id, action: 'PRODUCT_CREATE', entity: 'product', entityId: product.id, after: { ...product, openingQty: hasOpening ? input.openingQty : 0, openingCost: input.openingCost ?? null } }, tx);
          return product;
        });
      } catch (e) {
        // Two people auto-numbering at the same moment: retry with the next free code.
        if (!input.code && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && String(e.meta?.target).includes('code')) continue;
        throw e;
      }
    }
    throw new ConflictException('Could not pick a free product code. Please try again.');
  }

  async update(id: number, input: ProductInputT, user: SessionUser) {
    const before = await this.prisma.product.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Product not found');
    const name = normalizeName(input.name);
    if (before.isActive) await this.assertNameFree(name, id);
    await this.assertRefs(input);
    if (input.openingQty) throw new BadRequestException('Opening stock can only be set when creating a product. Use a stock adjustment instead.');

    const priceChanged =
      !D(before.salePrice).eq(input.salePrice) ||
      (before.mrp === null ? input.mrp !== null && input.mrp !== undefined : input.mrp === null || input.mrp === undefined || !D(before.mrp).eq(input.mrp));
    const canChangePrice = ([Role.ADMIN, Role.MANAGER] as Role[]).includes(user.role);
    if (priceChanged && !canChangePrice) throw new ForbiddenException('Only a manager can change the sale price or MRP');
    // Identity fields stay with managers: moving a barcode or code onto a cheaper item would bill the wrong price.
    if (!canChangePrice) {
      const identityChanged =
        (input.code?.trim() || before.code) !== before.code || (input.barcode?.trim() || null) !== before.barcode || nameKey(name) !== nameKey(before.name) || input.unitId !== before.unitId;
      if (identityChanged) throw new ForbiddenException('Only a manager can change the code, barcode, name or unit of a product');
    }

    // Pack size changes are safe: past purchase lines keep their own pack-size snapshot.
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.product.update({
        where: { id },
        data: {
          code: input.code?.trim() || before.code,
          barcode: input.barcode?.trim() || null,
          name,
          categoryId: input.categoryId,
          unitId: input.unitId,
          packUnitId: input.packUnitId ?? null,
          packSize: D(input.packSize),
          hsnCode: input.hsnCode?.trim() || null,
          gstRate: D(input.gstRate),
          mrp: input.mrp === null || input.mrp === undefined ? null : D(input.mrp),
          salePrice: D(input.salePrice),
          reorderLevel: D(input.reorderLevel),
          rackNo: input.rackNo ?? null,
        },
      });
      if (priceChanged) {
        await this.audit.log(
          { userId: user.id, action: 'PRICE_CHANGE', entity: 'product', entityId: id, before: { salePrice: before.salePrice, mrp: before.mrp }, after: { salePrice: after.salePrice, mrp: after.mrp } },
          tx,
        );
      }
      await this.audit.log({ userId: user.id, action: 'PRODUCT_UPDATE', entity: 'product', entityId: id, before, after }, tx);
      return after;
    });
  }

  async setActive(id: number, active: boolean, user: SessionUser) {
    const p = await this.prisma.product.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Product not found');
    if (active && !p.isActive) await this.assertNameFree(p.name, id);
    const after = await this.prisma.product.update({ where: { id }, data: { isActive: active } });
    await this.audit.log({ userId: user.id, action: active ? 'PRODUCT_ACTIVATE' : 'PRODUCT_DEACTIVATE', entity: 'product', entityId: id });
    return after;
  }

  async list(q: { q?: string; categoryId?: number; active?: 'true' | 'false' | 'all'; page: number; pageSize: number; lowStock?: boolean }, showCost: boolean) {
    const where: Prisma.ProductWhereInput = {};
    if (q.active !== 'all') where.isActive = q.active !== 'false';
    if (q.categoryId) where.categoryId = q.categoryId;
    if (q.q) {
      const term = q.q.trim();
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { code: { equals: term } },
        { barcode: { equals: term } },
        { code: { startsWith: term } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: { category: true, unit: true, packUnit: true, stock: true },
        orderBy: { name: 'asc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);
    return { rows: rows.map((p) => shapeProduct(p, showCost)), total, page: q.page, pageSize: q.pageSize };
  }

  async get(id: number, showCost: boolean) {
    const p = await this.prisma.product.findUnique({ where: { id }, include: { category: true, unit: true, packUnit: true, stock: true } });
    if (!p) throw new NotFoundException('Product not found');
    return shapeProduct(p, showCost);
  }

  /** Compact catalogue cached by the billing screen for instant search (NFR-01). Purchase cost only goes to roles that buy. */
  async catalogue(since: Date | undefined, showCost: boolean) {
    const rows = await this.prisma.product.findMany({
      where: since ? { updatedAt: { gt: since } } : { isActive: true },
      select: {
        id: true, code: true, barcode: true, name: true, salePrice: true, mrp: true, gstRate: true, isActive: true, categoryId: true, packSize: true, lastCost: true,
        unit: { select: { code: true, allowDecimal: true } },
        packUnit: { select: { code: true } },
        stock: { select: { onHand: true } },
      },
    });
    return {
      at: new Date().toISOString(),
      products: rows.map((p) => ({
        id: p.id, code: p.code, barcode: p.barcode, name: p.name, salePrice: p.salePrice, mrp: p.mrp, gstRate: p.gstRate,
        isActive: p.isActive, categoryId: p.categoryId, unit: p.unit.code, allowDecimal: p.unit.allowDecimal, onHand: p.stock?.onHand ?? 0,
        packSize: p.packSize, packUnit: p.packUnit?.code ?? null, lastCost: showCost ? p.lastCost : null,
      })),
    };
  }

  /** Top 24 best sellers of the last 30 days for the quick-keys grid. */
  async quickKeys() {
    const rows = await this.prisma.$queryRaw<{ product_id: number; qty: Prisma.Decimal }[]>`
      SELECT si.product_id, sum(si.qty) AS qty
      FROM sale_item si JOIN sale s ON s.id = si.sale_id JOIN product p ON p.id = si.product_id
      WHERE s.status = 'COMPLETED' AND si.product_id IS NOT NULL AND p.is_active
        AND s.billed_at >= now() - interval '30 days'
      GROUP BY si.product_id ORDER BY qty DESC LIMIT 24`;
    let ids = rows.map((r) => r.product_id);
    if (ids.length < 24) {
      const extra = await this.prisma.product.findMany({
        where: { isActive: true, id: { notIn: ids } },
        orderBy: { name: 'asc' },
        take: 24 - ids.length,
        select: { id: true },
      });
      ids = ids.concat(extra.map((e) => e.id));
    }
    return ids;
  }

  // ---------- Excel import / export (FR-09) ----------

  static readonly SHEET_COLUMNS = ['Code', 'Barcode', 'Name', 'Category', 'Unit', 'Pack Unit', 'Pack Size', 'HSN', 'GST %', 'MRP', 'Sale Price', 'Reorder Level', 'Rack'];

  async exportXlsx(): Promise<Buffer> {
    const products = await this.prisma.product.findMany({ include: { category: true, unit: true, packUnit: true }, orderBy: { name: 'asc' }, where: { isActive: true } });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Products');
    ws.addRow(ProductsService.SHEET_COLUMNS).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    for (const p of products) {
      ws.addRow([p.code, p.barcode ?? '', p.name, p.category.name, p.unit.code, p.packUnit?.code ?? '', Number(p.packSize), p.hsnCode ?? '', Number(p.gstRate), p.mrp === null ? '' : Number(p.mrp), Number(p.salePrice), Number(p.reorderLevel), p.rackNo ?? '']);
    }
    ws.columns.forEach((c, i) => (c.width = [10, 16, 40, 18, 8, 10, 10, 10, 8, 10, 10, 12, 8][i]));
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  /**
   * Bulk create/update from an XLSX with the export's columns. Rows are matched by Code.
   * All rows are checked first; nothing is saved unless every row is valid.
   */
  async importXlsx(buffer: Buffer, user: SessionUser) {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException('The file is not a valid .xlsx workbook');
    }
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException('The workbook has no sheets');
    const header = (ws.getRow(1).values as unknown[]).slice(1).map((v) => String(v ?? '').trim());
    const idx = (label: string) => header.findIndex((h) => h.toLowerCase() === label.toLowerCase());
    for (const col of ['Code', 'Name', 'Category', 'Unit', 'Sale Price']) {
      if (idx(col) < 0) throw new BadRequestException(`Column "${col}" is missing. Use the exported product sheet as a template.`);
    }
    const [categories, units, existing] = await Promise.all([
      this.prisma.category.findMany(),
      this.prisma.unit.findMany(),
      this.prisma.product.findMany({ select: { id: true, code: true, name: true, salePrice: true, mrp: true, isActive: true } }),
    ]);
    const catByName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));
    const unitByCode = new Map(units.map((u) => [u.code.toLowerCase(), u]));
    const byCode = new Map(existing.map((p) => [p.code, p]));
    const activeNames = new Map(existing.filter((p) => p.isActive).map((p) => [nameKey(p.name), p.code]));

    const errors: string[] = [];
    const rows: { code: string; data: ProductInputT; category: string }[] = [];
    const seenCodes = new Set<string>();
    const seenNames = new Map<string, string>();
    const cell = (r: ExcelJS.Row, label: string) => {
      const i = idx(label);
      if (i < 0) return '';
      const v = r.getCell(i + 1).value as unknown;
      if (v && typeof v === 'object' && 'result' in (v as object)) return String((v as { result: unknown }).result ?? '').trim();
      if (v && typeof v === 'object' && 'text' in (v as object)) return String((v as { text: unknown }).text ?? '').trim();
      return v === null || v === undefined ? '' : String(v).trim();
    };

    ws.eachRow((r, rowNo) => {
      if (rowNo === 1) return;
      const code = cell(r, 'Code');
      const name = cell(r, 'Name');
      if (!code && !name) return;
      const at = `Row ${rowNo}`;
      if (!code) return void errors.push(`${at}: Code is empty`);
      if (seenCodes.has(code)) return void errors.push(`${at}: Code ${code} appears twice in the file`);
      seenCodes.add(code);
      const unit = unitByCode.get(cell(r, 'Unit').toLowerCase());
      if (!unit) return void errors.push(`${at}: Unit "${cell(r, 'Unit')}" does not exist`);
      const packUnitCode = cell(r, 'Pack Unit');
      const packUnit = packUnitCode ? unitByCode.get(packUnitCode.toLowerCase()) : undefined;
      if (packUnitCode && !packUnit) return void errors.push(`${at}: Pack unit "${packUnitCode}" does not exist`);
      const categoryName = cell(r, 'Category');
      if (!categoryName) return void errors.push(`${at}: Category is empty`);
      const num = (label: string) => (cell(r, label) === '' ? undefined : Number(cell(r, label)));
      const parsed = ProductInput.safeParse({
        code,
        barcode: cell(r, 'Barcode') || null,
        name,
        categoryId: catByName.get(categoryName.toLowerCase())?.id ?? 1, // placeholder until categories are created
        unitId: unit.id,
        packUnitId: packUnit?.id ?? null,
        packSize: num('Pack Size') ?? 1,
        hsnCode: cell(r, 'HSN') || null,
        gstRate: num('GST %') ?? 0,
        mrp: num('MRP') ?? null,
        salePrice: num('Sale Price'),
        reorderLevel: num('Reorder Level') ?? 0,
        rackNo: cell(r, 'Rack') || null,
      });
      if (!parsed.success) return void errors.push(`${at}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join(', ')}`);
      const key = nameKey(name);
      if (seenNames.has(key)) return void errors.push(`${at}: Name "${name}" also appears for code ${seenNames.get(key)}`);
      seenNames.set(key, code);
      const clash = activeNames.get(key);
      if (clash && clash !== code) return void errors.push(`${at}: Name "${name}" already belongs to product code ${clash}`);
      rows.push({ code, data: parsed.data, category: categoryName });
    });

    if (errors.length) throw new BadRequestException({ message: `${errors.length} row(s) have problems. Nothing was imported.`, errors: errors.slice(0, 200) });
    if (rows.length === 0) throw new BadRequestException('The sheet has no product rows');

    const result = await this.prisma.$transaction(
      async (tx) => {
        let created = 0;
        let updated = 0;
        for (const row of rows) {
          let cat = catByName.get(row.category.toLowerCase());
          if (!cat) {
            cat = await tx.category.create({ data: { name: row.category } });
            catByName.set(cat.name.toLowerCase(), cat);
          }
          const d = row.data;
          const data = {
            barcode: d.barcode || null,
            name: normalizeName(d.name),
            categoryId: cat.id,
            unitId: d.unitId,
            packUnitId: d.packUnitId ?? null,
            packSize: D(d.packSize),
            hsnCode: d.hsnCode || null,
            gstRate: D(d.gstRate),
            mrp: d.mrp === null || d.mrp === undefined ? null : D(d.mrp),
            salePrice: D(d.salePrice),
            reorderLevel: D(d.reorderLevel),
            rackNo: d.rackNo ?? null,
          };
          const prev = byCode.get(row.code);
          if (prev) {
            await tx.product.update({ where: { id: prev.id }, data });
            if (!D(prev.salePrice).eq(data.salePrice) || String(prev.mrp ?? '') !== String(data.mrp ?? '')) {
              await this.audit.log({ userId: user.id, action: 'PRICE_CHANGE', entity: 'product', entityId: prev.id, before: { salePrice: prev.salePrice, mrp: prev.mrp }, after: { salePrice: data.salePrice, mrp: data.mrp }, ip: 'import' }, tx);
            }
            updated++;
          } else {
            const p = await tx.product.create({ data: { code: row.code, ...data } });
            await tx.productStock.create({ data: { productId: p.id, onHand: 0 } });
            created++;
          }
        }
        await this.audit.log({ userId: user.id, action: 'PRODUCT_IMPORT', entity: 'product', after: { created, updated } }, tx);
        return { created, updated };
      },
      { timeout: 120_000 },
    );
    return result;
  }
}

type ProductWithRefs = Prisma.ProductGetPayload<{ include: { category: true; unit: true; packUnit: true; stock: true } }>;
export function shapeProduct(p: ProductWithRefs, showCost = true) {
  return {
    id: p.id,
    code: p.code,
    barcode: p.barcode,
    name: p.name,
    categoryId: p.categoryId,
    categoryName: p.category.name,
    unitId: p.unitId,
    unitCode: p.unit.code,
    allowDecimal: p.unit.allowDecimal,
    packUnitId: p.packUnitId,
    packUnitCode: p.packUnit?.code ?? null,
    packSize: p.packSize,
    hsnCode: p.hsnCode,
    gstRate: p.gstRate,
    mrp: p.mrp,
    salePrice: p.salePrice,
    lastCost: showCost ? p.lastCost : null,
    reorderLevel: p.reorderLevel,
    rackNo: p.rackNo,
    isActive: p.isActive,
    onHand: p.stock?.onHand ?? 0,
    updatedAt: p.updatedAt,
  };
}

export { PRICE_FIELDS };
