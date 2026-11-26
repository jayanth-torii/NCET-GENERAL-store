import { JsonValue, withTx } from '../../config/db';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { Role } from '../../models/auth/model';
import { AdjustmentStatus, MovementKind } from '../../models/stock/model';
import ExcelJS from 'exceljs';
import { SessionUser } from '../../middleware/auth.decorators';
import { AuditService } from '../audit/service';
import { D, num, r3n } from '../../utils/money';
import { SettingsService } from '../settings/service';
import { applyMovements } from '../../utils/stock-ledger';
import { istRange } from '../../utils/time';
import { DbService } from '../../config/db';

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
    private readonly db: DbService,
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
    const term = q.q?.trim().toLowerCase() || null;
    // One MongoDB $group over the ledger up to the end date, splitting each product's movements into the
    // legacy Stock Summary columns (same buckets as the PostgreSQL FILTER clauses).
    const at = (d: Date) => d;
    const inRange = { $gte: ['$created_at', at(start)] };
    const bucket = (cond: JsonValue, sign = 1): JsonValue => ({ $sum: { $cond: [cond, sign === 1 ? '$qty' : { $multiply: ['$qty', -1] }, 0] } });
    const kindIs = (k: string) => ({ $eq: ['$kind', k] });
    const cancelOf = (ref: string) => ({ $and: [kindIs('CANCEL'), { $eq: ['$ref_type', ref] }] });
    const mv = await this.db.aggregate<{ _id: number; before: number; opening_in: number; purchased: number; sold: number; sales_ret: number; pur_ret: number; adjust: number }>('stock_movement', [
        { $match: { created_at: { $lt: at(end) } } },
        {
          $group: {
            _id: '$product_id',
            before: bucket({ $lt: ['$created_at', at(start)] }),
            opening_in: bucket({ $and: [inRange, kindIs('OPENING')] }),
            purchased: bucket({ $and: [inRange, { $or: [kindIs('PURCHASE'), cancelOf('PURCHASE')] }] }),
            sold: bucket({ $and: [inRange, { $or: [kindIs('SALE'), cancelOf('SALE')] }] }, -1),
            sales_ret: bucket({ $and: [inRange, kindIs('SALE_RETURN')] }),
            pur_ret: bucket({ $and: [inRange, kindIs('PURCHASE_RETURN')] }, -1),
            adjust: bucket({ $and: [inRange, kindIs('ADJUSTMENT')] }),
          },
        },
    ]);
    const byProduct = new Map(mv.map((m) => [Number(m._id), m]));
    const products = await this.db.product.findMany({
      where: q.categoryId ? { categoryId: q.categoryId } : {},
      include: { category: { select: { name: true } }, unit: { select: { code: true } }, stock: { select: { onHand: true } } },
    });
    const rows = products
      .filter((p) => p.isActive || byProduct.has(p.id) || q.includeInactive)
      .filter((p) => !term || p.name.toLowerCase().includes(term) || p.code.toLowerCase().includes(term) || p.barcode === q.q!.trim())
      .sort((a, b) => a.category.name.localeCompare(b.category.name, 'en', { sensitivity: 'base' }) || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
      .map((p) => {
        const m = byProduct.get(p.id);
        return {
          id: p.id, code: p.code, name: p.name, category: p.category.name, unit: p.unit.code, is_active: p.isActive,
          before: r3n(m?.before), opening_in: r3n(m?.opening_in), purchased: r3n(m?.purchased), sold: r3n(m?.sold),
          sales_ret: r3n(m?.sales_ret), pur_ret: r3n(m?.pur_ret), adjust: r3n(m?.adjust),
          last_cost: p.lastCost, reorder_level: p.reorderLevel, on_hand: p.stock?.onHand ?? 0,
        };
      });

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
    const products = await this.db.product.findMany({
      where: { isActive: true },
      include: { category: { select: { name: true } }, unit: { select: { code: true } }, stock: { select: { onHand: true } } },
    });
    const rows = products
      .map((p) => ({ id: p.id, code: p.code, name: p.name, category: p.category.name, unit: p.unit.code, on_hand: p.stock?.onHand ?? 0, reorder_level: p.reorderLevel, rack_no: p.rackNo }))
      .filter((r) => r.on_hand < 0 || (r.reorder_level > 0 && r.on_hand <= r.reorder_level))
      .sort((a, b) => Number(b.on_hand < 0) - Number(a.on_hand < 0) || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
    return rows.map((r) => ({
      productId: r.id, code: r.code, name: r.name, category: r.category, unit: r.unit, rackNo: r.rack_no,
      onHand: Number(r.on_hand), reorderLevel: Number(r.reorder_level), status: Number(r.on_hand) < 0 ? 'NEGATIVE' : 'LOW',
      shortBy: Math.max(0, Number(r.reorder_level) - Number(r.on_hand)),
    }));
  }

  /** Items holding stock that have not sold for `days` days. */
  async deadStock(days: number) {
    const since = new Date(Date.now() - days * 86400000);
    const [products, lastSales] = await Promise.all([
      this.db.product.findMany({ where: { isActive: true, stock: { is: { onHand: { gt: 0 } } } }, include: { category: { select: { name: true } }, stock: { select: { onHand: true } } } }),
      this.db.stockMovement.groupBy({ by: ['productId'], where: { kind: 'SALE' }, _max: { createdAt: true } }),
    ]);
    const lastSaleOf = new Map(lastSales.map((l) => [l.productId, l._max.createdAt]));
    const rows = products
      .filter((p) => (p.stock?.onHand ?? 0) > 0)
      .map((p) => ({ id: p.id, code: p.code, name: p.name, category: p.category.name, on_hand: p.stock?.onHand ?? 0, last_cost: p.lastCost, last_sale: lastSaleOf.get(p.id) ?? null }))
      .filter((r) => !r.last_sale || r.last_sale < since)
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
    return rows.map((r) => ({
      productId: r.id, code: r.code, name: r.name, category: r.category, onHand: Number(r.on_hand),
      value: Number(D(r.on_hand).mul(D(r.last_cost)).toDecimalPlaces(2)), lastSale: r.last_sale,
    }));
  }

  /** Item movement ledger with running balance (drill-down). */
  async movements(productId: number, from: string, to: string) {
    const product = await this.db.product.findUnique({ where: { id: productId }, include: { unit: true, stock: true } });
    if (!product) throw new NotFoundException('Product not found');
    const { start, end } = istRange(from, to);
    const openingAgg = await this.db.stockMovement.aggregate({ where: { productId, createdAt: { lt: start } }, _sum: { qty: true } });
    const moves = await this.db.stockMovement.findMany({
      where: { productId, createdAt: { gte: start, lt: end } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { createdBy: { select: { fullName: true } } },
    });
    // Document numbers for the ledger lines, looked up in one query per document type.
    const idsOf = (t: string) => [...new Set(moves.filter((m) => m.refType === t).map((m) => m.refId))];
    const [sales, purchases, sReturns, pReturns] = await Promise.all([
      this.db.sale.findMany({ where: { id: { in: idsOf('SALE') } }, select: { id: true, billNo: true } }),
      this.db.purchase.findMany({ where: { id: { in: idsOf('PURCHASE').map(Number) } }, select: { id: true, purchaseNo: true } }),
      this.db.salesReturn.findMany({ where: { id: { in: idsOf('SALES_RETURN').map(Number) } }, select: { id: true, returnNo: true } }),
      this.db.purchaseReturn.findMany({ where: { id: { in: idsOf('PURCHASE_RETURN').map(Number) } }, select: { id: true, returnNo: true } }),
    ]);
    const doc = new Map<string, string>([
      ...sales.map((s) => [`SALE:${s.id}`, s.billNo] as [string, string]),
      ...purchases.map((p) => [`PURCHASE:${p.id}`, p.purchaseNo ?? 'Draft'] as [string, string]),
      ...sReturns.map((r) => [`SALES_RETURN:${r.id}`, r.returnNo] as [string, string]),
      ...pReturns.map((r) => [`PURCHASE_RETURN:${r.id}`, r.returnNo] as [string, string]),
    ]);
    const rows = moves.map((m) => ({
      id: m.id, kind: m.kind as string, qty: m.qty, unit_cost: m.unitCost, ref_type: m.refType, ref_id: m.refId, note: m.note, created_at: m.createdAt,
      user_name: m.createdBy?.fullName ?? null,
      doc_no: m.refType === 'ADJUSTMENT' ? `ADJ-${m.refId}` : (doc.get(`${m.refType}:${m.refId}`) ?? (m.refType === 'OPENING' ? 'Opening' : null)),
    }));
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
    const product = await this.db.product.findUnique({ where: { id: input.productId }, include: { unit: true, stock: true } });
    if (!product) throw new NotFoundException('Product not found');
    if (input.countedQty !== undefined && !product.unit.allowDecimal && !Number.isInteger(input.countedQty)) throw new BadRequestException(`${product.name} is counted in whole ${product.unit.code}`);
    if (input.qtyChange !== undefined && !product.unit.allowDecimal && !Number.isInteger(input.qtyChange)) throw new BadRequestException(`${product.name} is counted in whole ${product.unit.code}`);
    const direct = MANAGERS.includes(user.role);
    const settings = await this.settings.get();
    return withTx(this.db, async (tx) => {
      // The difference from a shelf count is worked out on the balance read inside this transaction. If a
      // sale changes it before commit, MongoDB reports a write conflict and withTx re-runs the whole step,
      // so a sale in between cannot skew it (PostgreSQL did this with SELECT … FOR UPDATE).
      const bal = await tx.productStock.findUnique({ where: { productId: product.id }, select: { onHand: true } });
      const onHand = D(bal?.onHand ?? 0);
      const change = input.countedQty !== undefined ? D(input.countedQty).minus(onHand) : D(input.qtyChange ?? 0);
      if (change.isZero()) throw new BadRequestException('The adjustment does not change the stock');
      const adj = await tx.stockAdjustment.create({
        data: {
          productId: product.id,
          qtyChange: num(change),
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
    return withTx(this.db, async (tx) => {
      // Two managers deciding at once both update this document; MongoDB lets one commit and the other is
      // re-run by withTx, which then sees it is no longer PENDING.
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
    return this.db.stockAdjustment.findMany({
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
    const products = await this.db.product.findMany({ include: { unit: true, stock: true } });
    const byCode = new Map(products.map((p) => [p.code, p]));
    const errors: string[] = [];
    const rows: { p: (typeof products)[number]; counted: Decimal; cost: Decimal | null }[] = [];
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
      let cost: Decimal | null = null;
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
    return withTx(this.db, 
      async (tx) => {
        let changed = 0;
        const changes: { code: string; name: string; before: number; after: number }[] = [];
        for (const r of rows) {
          if (r.cost) await tx.product.update({ where: { id: r.p.id }, data: { lastCost: num(r.cost) } });
          const bal = await tx.productStock.findUnique({ where: { productId: r.p.id }, select: { onHand: true } });
          const before = D(bal?.onHand ?? 0);
          const delta = r.counted.minus(before);
          if (delta.isZero()) continue;
          // First count of a product is its opening stock. Any later count is an approved adjustment,
          // so a mid-year write-off shows in the Adjustments list and the Adjust column, never as "opening".
          const hasHistory = (await tx.stockMovement.count({ where: { productId: r.p.id } })) > 0;
          if (hasHistory) {
            const adj = await tx.stockAdjustment.create({
              data: { productId: r.p.id, qtyChange: num(delta), reason: 'Physical count sheet', status: AdjustmentStatus.APPROVED, requestedById: user.id, decidedById: user.id, decidedAt: new Date() },
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
