import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AdjustmentStatus, MovementKind, Prisma, Role } from '@prisma/client';
import ExcelJS from 'exceljs';
import { SessionUser } from '../auth/auth.decorators';
import { AuditService } from '../common/audit.service';
import { D } from '../common/money';
import { SettingsService } from '../common/settings.service';
import { applyMovements } from '../common/stock-ledger';
import { istRange } from '../common/time';
import { PrismaService } from '../prisma/prisma.service';

export type StockRow = {
  productId: number;
  code: string;
  name: string;
  category: string;
  unit: string;
  opening: number;
  purchased: number;
  sold: number;
  salesReturn: number;
  purchaseReturn: number;
  adjustment: number;
  closing: number;
  cost: number;
  value: number;
  reorderLevel: number;
  onHand: number;
  belowReorder: boolean;
  isActive: boolean;
};

const MANAGERS: Role[] = [Role.ADMIN, Role.MANAGER];

/** Plain value of an Excel cell, unwrapping formulas and rich text. */
function cellValue(v: ExcelJS.CellValue): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'object' && 'result' in v) return (v.result as number | string | null) ?? null;
  if (typeof v === 'object' && 'richText' in v) return v.richText.map((t) => t.text).join('');
  return String(v);
}

@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Stock summary for a date range (UR-4, rule R1):
   *   Closing = Opening + Purchased - Sold + SalesReturn - PurchaseReturn +/- Adjustment
   * Opening is every movement before the start date, plus opening counts loaded inside the range.
   * Cancelled bills and purchases are netted into Sold and Purchased.
   */
  async summary(q: { from: string; to: string; categoryId?: number; q?: string; belowReorderOnly?: boolean; includeInactive?: boolean }): Promise<StockRow[]> {
    const { start, end } = istRange(q.from, q.to);
    const term = q.q?.trim() ? `%${q.q.trim()}%` : null;
    const rows = await this.prisma.$queryRaw<
      {
        id: number; code: string; name: string; category: string; unit: string; is_active: boolean;
        before: Prisma.Decimal | null; opening_in: Prisma.Decimal | null; purchased: Prisma.Decimal | null; sold: Prisma.Decimal | null;
        sales_ret: Prisma.Decimal | null; pur_ret: Prisma.Decimal | null; adjust: Prisma.Decimal | null;
        last_cost: Prisma.Decimal | null; reorder_level: Prisma.Decimal; on_hand: Prisma.Decimal | null;
      }[]
    >`
      WITH mv AS (
        SELECT product_id,
          sum(qty) FILTER (WHERE created_at < ${start}) AS before,
          sum(qty) FILTER (WHERE created_at >= ${start} AND kind = 'OPENING') AS opening_in,
          sum(qty) FILTER (WHERE created_at >= ${start} AND (kind = 'PURCHASE' OR (kind = 'CANCEL' AND ref_type = 'PURCHASE'))) AS purchased,
          -sum(qty) FILTER (WHERE created_at >= ${start} AND (kind = 'SALE' OR (kind = 'CANCEL' AND ref_type = 'SALE'))) AS sold,
          sum(qty) FILTER (WHERE created_at >= ${start} AND kind = 'SALE_RETURN') AS sales_ret,
          -sum(qty) FILTER (WHERE created_at >= ${start} AND kind = 'PURCHASE_RETURN') AS pur_ret,
          sum(qty) FILTER (WHERE created_at >= ${start} AND kind = 'ADJUSTMENT') AS adjust
        FROM stock_movement
        WHERE created_at < ${end}
        GROUP BY product_id
      )
      SELECT p.id, p.code, p.name, c.name AS category, u.code AS unit, p.is_active,
             mv.before, mv.opening_in, mv.purchased, mv.sold, mv.sales_ret, mv.pur_ret, mv.adjust,
             p.last_cost, p.reorder_level, ps.on_hand
      FROM product p
      JOIN category c ON c.id = p.category_id
      JOIN unit u ON u.id = p.unit_id
      LEFT JOIN mv ON mv.product_id = p.id
      LEFT JOIN product_stock ps ON ps.product_id = p.id
      WHERE (p.is_active OR mv.product_id IS NOT NULL ${q.includeInactive ? Prisma.sql`OR TRUE` : Prisma.empty})
        ${q.categoryId ? Prisma.sql`AND p.category_id = ${q.categoryId}` : Prisma.empty}
        ${term ? Prisma.sql`AND (p.name ILIKE ${term} OR p.code ILIKE ${term} OR p.barcode = ${q.q!.trim()})` : Prisma.empty}
      ORDER BY c.name, p.name`;

    const out = rows.map((r) => {
      const opening = D(r.before).plus(D(r.opening_in));
      const purchased = D(r.purchased);
      const sold = D(r.sold);
      const salesReturn = D(r.sales_ret);
      const purchaseReturn = D(r.pur_ret);
      const adjustment = D(r.adjust);
      const closing = opening.plus(purchased).minus(sold).plus(salesReturn).minus(purchaseReturn).plus(adjustment);
      const cost = D(r.last_cost);
      return {
        productId: r.id,
        code: r.code,
        name: r.name,
        category: r.category,
        unit: r.unit,
        opening: opening.toNumber(),
        purchased: purchased.toNumber(),
        sold: sold.toNumber(),
        salesReturn: salesReturn.toNumber(),
        purchaseReturn: purchaseReturn.toNumber(),
        adjustment: adjustment.toNumber(),
        closing: closing.toNumber(),
        cost: cost.toNumber(),
        value: closing.gt(0) ? closing.mul(cost).toDecimalPlaces(2).toNumber() : 0,
        reorderLevel: Number(r.reorder_level),
        onHand: Number(r.on_hand ?? 0),
        belowReorder: Number(r.reorder_level) > 0 && Number(r.on_hand ?? 0) <= Number(r.reorder_level),
        isActive: r.is_active,
      };
    });
    return q.belowReorderOnly ? out.filter((r) => r.belowReorder) : out;
  }

  /** Items at or below their reorder level, and items below zero (R8). */
  async lowAndNegative() {
    const rows = await this.prisma.$queryRaw<{ id: number; code: string; name: string; category: string; unit: string; on_hand: Prisma.Decimal; reorder_level: Prisma.Decimal; rack_no: string | null }[]>`
      SELECT p.id, p.code, p.name, c.name AS category, u.code AS unit, coalesce(ps.on_hand, 0) AS on_hand, p.reorder_level, p.rack_no
      FROM product p JOIN category c ON c.id = p.category_id JOIN unit u ON u.id = p.unit_id
      LEFT JOIN product_stock ps ON ps.product_id = p.id
      WHERE p.is_active AND (coalesce(ps.on_hand, 0) < 0 OR (p.reorder_level > 0 AND coalesce(ps.on_hand, 0) <= p.reorder_level))
      ORDER BY coalesce(ps.on_hand, 0) < 0 DESC, p.name`;
    return rows.map((r) => ({
      productId: r.id, code: r.code, name: r.name, category: r.category, unit: r.unit, rackNo: r.rack_no,
      onHand: Number(r.on_hand), reorderLevel: Number(r.reorder_level), status: Number(r.on_hand) < 0 ? 'NEGATIVE' : 'LOW',
      shortBy: Math.max(0, Number(r.reorder_level) - Number(r.on_hand)),
    }));
  }

  /** Items holding stock that have not sold for `days` days. */
  async deadStock(days: number) {
    const rows = await this.prisma.$queryRaw<{ id: number; code: string; name: string; category: string; on_hand: Prisma.Decimal; last_cost: Prisma.Decimal | null; last_sale: Date | null }[]>`
      SELECT p.id, p.code, p.name, c.name AS category, ps.on_hand, p.last_cost,
             (SELECT max(created_at) FROM stock_movement m WHERE m.product_id = p.id AND m.kind = 'SALE') AS last_sale
      FROM product p JOIN category c ON c.id = p.category_id JOIN product_stock ps ON ps.product_id = p.id
      WHERE p.is_active AND ps.on_hand > 0
        AND NOT EXISTS (SELECT 1 FROM stock_movement m WHERE m.product_id = p.id AND m.kind = 'SALE' AND m.created_at >= now() - make_interval(days => ${days}))
      ORDER BY p.name`;
    return rows.map((r) => ({
      productId: r.id, code: r.code, name: r.name, category: r.category, onHand: Number(r.on_hand),
      value: Number(D(r.on_hand).mul(D(r.last_cost)).toDecimalPlaces(2)), lastSale: r.last_sale,
    }));
  }

  /** Item movement ledger with running balance (drill-down). */
  async movements(productId: number, from: string, to: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId }, include: { unit: true, stock: true } });
    if (!product) throw new NotFoundException('Product not found');
    const { start, end } = istRange(from, to);
    const openingAgg = await this.prisma.stockMovement.aggregate({ where: { productId, createdAt: { lt: start } }, _sum: { qty: true } });
    const rows = await this.prisma.$queryRaw<{ id: bigint; kind: string; qty: Prisma.Decimal; unit_cost: Prisma.Decimal | null; ref_type: string; ref_id: bigint; note: string | null; created_at: Date; user_name: string | null; doc_no: string | null }[]>`
      SELECT m.id, m.kind::text AS kind, m.qty, m.unit_cost, m.ref_type, m.ref_id, m.note, m.created_at, u.full_name AS user_name,
        CASE m.ref_type
          WHEN 'SALE' THEN (SELECT bill_no FROM sale WHERE id = m.ref_id)
          WHEN 'PURCHASE' THEN (SELECT coalesce(purchase_no, 'Draft') FROM purchase WHERE id = m.ref_id)
          WHEN 'SALES_RETURN' THEN (SELECT return_no FROM sales_return WHERE id = m.ref_id)
          WHEN 'PURCHASE_RETURN' THEN (SELECT return_no FROM purchase_return WHERE id = m.ref_id)
          WHEN 'ADJUSTMENT' THEN 'ADJ-' || m.ref_id
          ELSE 'Opening'
        END AS doc_no
      FROM stock_movement m LEFT JOIN app_user u ON u.id = m.created_by
      WHERE m.product_id = ${productId} AND m.created_at >= ${start} AND m.created_at < ${end}
      ORDER BY m.created_at, m.id`;
    let bal = D(openingAgg._sum.qty);
    const opening = bal.toNumber();
    const lines = rows.map((r) => {
      bal = bal.plus(D(r.qty));
      return {
        id: r.id, at: r.created_at, kind: r.kind, docNo: r.doc_no, refType: r.ref_type, refId: r.ref_id,
        inQty: D(r.qty).gt(0) ? Number(r.qty) : 0, outQty: D(r.qty).lt(0) ? -Number(r.qty) : 0,
        balance: bal.toNumber(), unitCost: r.unit_cost === null ? null : Number(r.unit_cost), user: r.user_name, note: r.note,
      };
    });
    return { product: { id: product.id, code: product.code, name: product.name, unit: product.unit.code, onHand: Number(product.stock?.onHand ?? 0) }, opening, closing: bal.toNumber(), lines };
  }

  // ---------- Adjustments (FR-15) ----------

  /** Manager/admin adjustments apply at once; a store keeper's adjustment waits for manager approval. */
  async createAdjustment(input: { productId: number; qtyChange?: number; countedQty?: number; reason: string }, user: SessionUser, ip: string) {
    const product = await this.prisma.product.findUnique({ where: { id: input.productId }, include: { unit: true, stock: true } });
    if (!product) throw new NotFoundException('Product not found');
    if (input.countedQty !== undefined && !product.unit.allowDecimal && !Number.isInteger(input.countedQty)) throw new BadRequestException(`${product.name} is counted in whole ${product.unit.code}`);
    if (input.qtyChange !== undefined && !product.unit.allowDecimal && !Number.isInteger(input.qtyChange)) throw new BadRequestException(`${product.name} is counted in whole ${product.unit.code}`);
    const direct = MANAGERS.includes(user.role);
    const settings = await this.settings.get();
    return this.prisma.$transaction(async (tx) => {
      // The difference from a shelf count is worked out on the locked balance, so a sale in between cannot skew it.
      const locked = await tx.$queryRaw<{ on_hand: Prisma.Decimal }[]>`SELECT on_hand FROM product_stock WHERE product_id = ${product.id} FOR UPDATE`;
      const onHand = D(locked[0]?.on_hand ?? 0);
      const change = input.countedQty !== undefined ? D(input.countedQty).minus(onHand) : D(input.qtyChange ?? 0);
      if (change.isZero()) throw new BadRequestException('The adjustment does not change the stock');
      const adj = await tx.stockAdjustment.create({
        data: {
          productId: product.id,
          qtyChange: change,
          reason: input.reason,
          status: direct ? AdjustmentStatus.APPROVED : AdjustmentStatus.PENDING,
          requestedById: user.id,
          decidedById: direct ? user.id : null,
          decidedAt: direct ? new Date() : null,
        },
      });
      let warnings: Awaited<ReturnType<typeof applyMovements>> = [];
      if (direct) {
        warnings = await applyMovements(tx, [{ productId: product.id, kind: MovementKind.ADJUSTMENT, qty: change, unitCost: product.lastCost, refType: 'ADJUSTMENT', refId: adj.id, note: input.reason }], user.id, { blockNegative: settings.blockNegativeStock });
      }
      await this.audit.log({ userId: user.id, action: direct ? 'STOCK_ADJUST' : 'STOCK_ADJUST_REQUEST', entity: 'product', entityId: product.id, ip, before: { onHand }, after: { change, reason: input.reason, adjustmentId: adj.id } }, tx);
      return { ...adj, warnings };
    });
  }

  async decideAdjustment(id: number, approve: boolean, note: string | null, user: SessionUser, ip: string) {
    const settings = await this.settings.get();
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM stock_adjustment WHERE id = ${id} FOR UPDATE`;
      const adj = await tx.stockAdjustment.findUnique({ where: { id }, include: { product: true } });
      if (!adj) throw new NotFoundException('Adjustment not found');
      if (adj.status !== AdjustmentStatus.PENDING) throw new ConflictException('This adjustment was already decided');
      if (adj.requestedById === user.id) throw new ForbiddenException('You cannot approve your own request');
      const updated = await tx.stockAdjustment.update({
        where: { id },
        data: { status: approve ? AdjustmentStatus.APPROVED : AdjustmentStatus.REJECTED, decidedById: user.id, decidedAt: new Date(), decisionNote: note },
      });
      let warnings: Awaited<ReturnType<typeof applyMovements>> = [];
      if (approve) {
        warnings = await applyMovements(tx, [{ productId: adj.productId, kind: MovementKind.ADJUSTMENT, qty: D(adj.qtyChange), unitCost: adj.product.lastCost, refType: 'ADJUSTMENT', refId: adj.id, note: adj.reason }], user.id, { blockNegative: settings.blockNegativeStock });
      }
      await this.audit.log({ userId: user.id, action: approve ? 'STOCK_ADJUST_APPROVE' : 'STOCK_ADJUST_REJECT', entity: 'product', entityId: adj.productId, ip, after: { adjustmentId: id, change: adj.qtyChange, note } }, tx);
      return { ...updated, warnings };
    });
  }

  listAdjustments(status?: AdjustmentStatus) {
    return this.prisma.stockAdjustment.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: 300,
      include: {
        product: { select: { code: true, name: true, unit: { select: { code: true } }, stock: { select: { onHand: true } } } },
        requestedBy: { select: { fullName: true } },
        decidedBy: { select: { fullName: true } },
      },
    });
  }

  /**
   * Cutover-day physical count (migration step 4). Each row sets the product's stock to the counted
   * quantity with an OPENING movement for the difference. All rows are checked before anything is saved.
   */
  async importOpeningCount(buffer: Buffer, user: SessionUser, ip: string) {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException('The file is not a valid .xlsx workbook');
    }
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException('The workbook has no sheets');
    const header = (ws.getRow(1).values as unknown[]).slice(1).map((v) => String(v ?? '').trim().toLowerCase());
    const ci = header.indexOf('code');
    const qi = header.indexOf('counted qty');
    const costI = header.indexOf('cost');
    if (ci < 0 || qi < 0) throw new BadRequestException('The sheet needs columns "Code" and "Counted Qty" (and optionally "Cost")');
    const products = await this.prisma.product.findMany({ include: { unit: true, stock: true } });
    const byCode = new Map(products.map((p) => [p.code, p]));
    const errors: string[] = [];
    const rows: { p: (typeof products)[number]; counted: Prisma.Decimal; cost: Prisma.Decimal | null }[] = [];
    const seen = new Set<string>();
    ws.eachRow((r, n) => {
      if (n === 1) return;
      const code = r.getCell(ci + 1).text.trim();
      const qRaw = cellValue(r.getCell(qi + 1).value);
      if (!code && (qRaw === null || qRaw === undefined || qRaw === '')) return;
      const p = byCode.get(code);
      if (!p) return void errors.push(`Row ${n}: product code "${code}" not found`);
      if (seen.has(code)) return void errors.push(`Row ${n}: code ${code} appears twice`);
      seen.add(code);
      const q = Number(qRaw);
      if (!Number.isFinite(q) || q < 0) return void errors.push(`Row ${n}: counted quantity must be zero or more`);
      if (!p.unit.allowDecimal && !Number.isInteger(q)) return void errors.push(`Row ${n}: ${p.name} is counted in whole ${p.unit.code}`);
      let cost: Prisma.Decimal | null = null;
      if (costI >= 0) {
        const c = cellValue(r.getCell(costI + 1).value);
        if (c !== null && c !== undefined && c !== '') {
          if (!Number.isFinite(Number(c)) || Number(c) < 0) return void errors.push(`Row ${n}: cost must be zero or more`);
          cost = D(Number(c)).toDecimalPlaces(4);
        }
      }
      rows.push({ p, counted: D(q), cost });
    });
    if (errors.length) throw new BadRequestException({ message: `${errors.length} row(s) have problems. Nothing was loaded.`, errors: errors.slice(0, 200) });
    if (rows.length === 0) throw new BadRequestException('The sheet has no rows');
    return this.prisma.$transaction(
      async (tx) => {
        let changed = 0;
        const changes: { code: string; name: string; before: number; after: number }[] = [];
        for (const r of rows) {
          if (r.cost) await tx.product.update({ where: { id: r.p.id }, data: { lastCost: r.cost } });
          const locked = await tx.$queryRaw<{ on_hand: Prisma.Decimal }[]>`SELECT on_hand FROM product_stock WHERE product_id = ${r.p.id} FOR UPDATE`;
          const before = D(locked[0]?.on_hand ?? 0);
          const delta = r.counted.minus(before);
          if (delta.isZero()) continue;
          // First count of a product is its opening stock. Any later count is an approved adjustment,
          // so a mid-year write-off shows in the Adjustments list and the Adjust column, never as "opening".
          const hasHistory = (await tx.stockMovement.count({ where: { productId: r.p.id } })) > 0;
          if (hasHistory) {
            const adj = await tx.stockAdjustment.create({
              data: { productId: r.p.id, qtyChange: delta, reason: 'Physical count sheet', status: AdjustmentStatus.APPROVED, requestedById: user.id, decidedById: user.id, decidedAt: new Date() },
            });
            await applyMovements(tx, [{ productId: r.p.id, kind: MovementKind.ADJUSTMENT, qty: delta, unitCost: r.cost ?? r.p.lastCost, refType: 'ADJUSTMENT', refId: adj.id, note: 'Physical count sheet' }], user.id, { blockNegative: false });
          } else {
            await applyMovements(tx, [{ productId: r.p.id, kind: MovementKind.OPENING, qty: delta, unitCost: r.cost ?? r.p.lastCost, refType: 'OPENING', refId: r.p.id, note: 'Opening count' }], user.id, { blockNegative: false });
          }
          changes.push({ code: r.p.code, name: r.p.name, before: before.toNumber(), after: r.counted.toNumber() });
          changed++;
        }
        await this.audit.log({ userId: user.id, action: 'OPENING_COUNT_IMPORT', entity: 'stock', ip, after: { rows: rows.length, changed, changes } }, tx);
        return { rows: rows.length, changed };
      },
      { timeout: 120_000 },
    );
  }
}
