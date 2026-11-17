import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MovementKind, PaymentMode, Prisma, Role, SaleStatus, StoreSetting } from '@prisma/client';
import { z } from 'zod';
import { SessionUser } from '../auth/auth.decorators';
import { AuditService } from '../common/audit.service';
import { nextBillNo, nextDocNo } from '../common/doc-number';
import { D, Dec, round2, sum } from '../common/money';
import { SettingsService } from '../common/settings.service';
import { applyMovements, Movement, StockWarning } from '../common/stock-ledger';
import { istDate, istRange, isSameIstDay } from '../common/time';
import { zMoney, zOptText, zQty, zReason } from '../common/validate';
import { PrismaService } from '../prisma/prisma.service';
import { CalcError, calcSale, CalcLineInput, settlePayments } from './sale-calc';

type Tx = Prisma.TransactionClient;

export const SaleLineInput = z
  .object({
    productId: z.coerce.number().int().positive().optional(),
    kitId: z.coerce.number().int().positive().optional(),
    qty: zQty,
    rate: zMoney.optional(), // only a manager may bill at a price other than the master price
    discount: zMoney.default(0),
  })
  .refine((l) => Boolean(l.productId) !== Boolean(l.kitId), 'Each line needs either a product or a kit');

export const SaleInput = z.object({
  items: z.array(SaleLineInput).min(1, 'The bill has no items').max(300, 'A bill can have at most 300 lines'),
  payments: z
    .array(z.object({ mode: z.nativeEnum(PaymentMode), amount: zMoney, reference: zOptText(60) }))
    .max(6)
    .default([]),
  customerName: zOptText(80),
  remarks: zOptText(200),
  heldBillId: z.coerce.number().int().positive().optional(),
});
export type SaleInputT = z.infer<typeof SaleInput>;

export const ReturnInput = z.object({
  items: z.array(z.object({ saleItemId: z.coerce.number().int().positive(), qty: zQty })).min(1).max(300),
  reason: zReason,
  refundMode: z.nativeEnum(PaymentMode).default(PaymentMode.CASH),
});

const MANAGERS: Role[] = [Role.ADMIN, Role.MANAGER];

interface PreparedLine {
  productId: number | null;
  kitId: number | null;
  code: string;
  name: string;
  qty: Dec;
  rate: Dec;
  masterRate: Dec;
  discount: Dec;
  gstRate: Dec;
  unitCost: Dec;
  components: { productId: number; qtyPerKit: Dec; gstRate: Dec; unitCost: Dec }[];
  calc: CalcLineInput;
}

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  /** Resolve products and kits, apply price and discount permissions, and check quantities. */
  private async prepareLines(items: SaleInputT['items'], user: SessionUser): Promise<PreparedLine[]> {
    const settings = await this.settings.get();
    const productIds = [...new Set(items.filter((i) => i.productId).map((i) => i.productId!))];
    const kitIds = [...new Set(items.filter((i) => i.kitId).map((i) => i.kitId!))];
    const [products, kits] = await Promise.all([
      this.prisma.product.findMany({ where: { id: { in: productIds } }, include: { unit: true } }),
      this.prisma.kit.findMany({ where: { id: { in: kitIds } }, include: { items: { include: { product: { include: { unit: true } } } } } }),
    ]);
    const pMap = new Map(products.map((p) => [p.id, p]));
    const kMap = new Map(kits.map((k) => [k.id, k]));
    const isManager = MANAGERS.includes(user.role);
    const maxPct = D(settings.maxCashierDiscount);

    return items.map((it, idx) => {
      const n = idx + 1;
      const qty = D(it.qty);
      const discount = D(it.discount ?? 0);
      if (it.productId) {
        const p = pMap.get(it.productId);
        if (!p) throw new BadRequestException(`Line ${n}: product not found`);
        if (!p.isActive) throw new BadRequestException(`Line ${n}: ${p.name} is switched off and cannot be sold`);
        if (!p.unit.allowDecimal && !qty.isInteger()) throw new BadRequestException(`Line ${n}: ${p.name} is sold in whole ${p.unit.code}`);
        const rate = this.checkRate(n, p.name, D(p.salePrice), it.rate, isManager, p.mrp === null ? null : D(p.mrp));
        this.checkDiscount(n, p.name, qty.mul(rate), discount, isManager, maxPct);
        return {
          productId: p.id, kitId: null, code: p.code, name: p.name, qty, rate, masterRate: D(p.salePrice), discount, gstRate: D(p.gstRate),
          unitCost: D(p.lastCost ?? 0), components: [],
          calc: { qty, rate, discount, parts: [{ weight: D(1), gstRate: D(p.gstRate) }] },
        };
      }
      const k = kMap.get(it.kitId!);
      if (!k) throw new BadRequestException(`Line ${n}: kit not found`);
      if (!k.isActive) throw new BadRequestException(`Line ${n}: kit ${k.name} is switched off`);
      if (!qty.isInteger()) throw new BadRequestException(`Line ${n}: kits are sold in whole numbers`);
      if (k.items.length === 0) throw new BadRequestException(`Line ${n}: kit ${k.name} has no items`);
      for (const ki of k.items) {
        if (!ki.product.isActive) throw new BadRequestException(`Line ${n}: kit ${k.name} contains ${ki.product.name}, which is switched off`);
      }
      const rate = this.checkRate(n, k.name, D(k.price), it.rate, isManager, null);
      this.checkDiscount(n, k.name, qty.mul(rate), discount, isManager, maxPct);
      const components = k.items.map((ki) => ({ productId: ki.productId, qtyPerKit: D(ki.qty), gstRate: D(ki.product.gstRate), unitCost: D(ki.product.lastCost ?? 0) }));
      return {
        productId: null, kitId: k.id, code: k.code, name: k.name, qty, rate, masterRate: D(k.price), discount, gstRate: D(0),
        unitCost: sum(components.map((c) => c.unitCost.mul(c.qtyPerKit))), components,
        calc: { qty, rate, discount, parts: k.items.map((ki) => ({ weight: D(ki.product.salePrice).mul(ki.qty), gstRate: D(ki.product.gstRate) })) },
      };
    });
  }

  private checkRate(n: number, name: string, master: Dec, given: number | undefined, isManager: boolean, mrp: Dec | null): Dec {
    if (given === undefined || D(given).eq(master)) return master;
    if (!isManager) throw new ForbiddenException(`Line ${n}: only a manager can change the price of ${name}`);
    const rate = D(given);
    if (rate.lte(0)) throw new BadRequestException(`Line ${n}: price of ${name} must be more than zero. Use a discount or a stock adjustment to give goods away.`);
    if (mrp && rate.gt(mrp)) throw new BadRequestException(`Line ${n}: price of ${name} cannot be more than the MRP ${mrp.toFixed(2)}`);
    return rate;
  }

  /** A manager billing below the master price must say why; the bill is flagged and the override logged. */
  private overrideCheck(lines: PreparedLine[], remarks: string | null | undefined) {
    const overridden = lines.filter((l) => !l.rate.eq(l.masterRate));
    if (overridden.length === 0) return false;
    if (!remarks || remarks.trim().length < 3) throw new BadRequestException('Add a remark saying why the price was changed on this bill');
    return true;
  }

  private checkDiscount(n: number, name: string, gross: Dec, discount: Dec, isManager: boolean, maxPct: Dec) {
    if (discount.lte(0) || isManager) return;
    const limit = round2(gross.mul(maxPct).div(100));
    if (discount.gt(limit)) {
      throw new ForbiddenException(
        maxPct.isZero() ? `Line ${n}: only a manager can give a discount` : `Line ${n}: discount on ${name} is above the cashier limit of ${maxPct.toString()}%`,
      );
    }
  }

  private movementsFor(lines: { productId: number | null; qty: Dec; unitCost: Dec; components: { productId: number; qtyPerKit: Dec; unitCost: Dec }[] }[], sign: 1 | -1, kind: MovementKind, refType: string, refId: bigint | number, note?: string): Movement[] {
    const out: Movement[] = [];
    for (const l of lines) {
      if (l.productId) out.push({ productId: l.productId, kind, qty: l.qty.mul(sign), unitCost: l.unitCost, refType, refId, note });
      for (const c of l.components) out.push({ productId: c.productId, kind, qty: l.qty.mul(c.qtyPerKit).mul(sign), unitCost: c.unitCost, refType, refId, note });
    }
    return out;
  }

  private compute(lines: PreparedLine[], payments: SaleInputT['payments'], settings: StoreSetting) {
    try {
      const totals = calcSale(lines.map((l) => l.calc), { roundToRupee: settings.roundBillToRupee, gstRegistered: settings.gstMode === 'REGISTERED' });
      const pays = payments.length ? payments : [];
      if (pays.length === 0 && totals.grandTotal.gt(0)) throw new CalcError('Enter how the customer paid');
      const settlement = settlePayments(totals.grandTotal, pays.map((p) => ({ mode: p.mode, amount: D(p.amount), reference: p.reference })));
      for (const p of settlement.applied) {
        const ref = (p.reference ?? '').trim();
        const required = (p.mode === 'UPI' && settings.requireUpiReference) || (p.mode === 'CARD' && settings.requireCardReference);
        if (required && !ref) throw new CalcError(`${p.mode} payment needs the transaction ID from the customer's ${p.mode === 'UPI' ? 'UPI app' : 'card slip'}`);
        if (ref && !/^[A-Za-z0-9-]{6,32}$/.test(ref)) throw new CalcError(`${p.mode} transaction ID must be 6 to 32 letters or digits`);
        p.reference = ref || null;
      }
      return { totals, settlement };
    } catch (e) {
      if (e instanceof CalcError) throw new BadRequestException(e.message);
      throw e;
    }
  }

  /**
   * A UPI or card transaction can pay for one bill only. Inside the transaction, so two counters
   * claiming the same transaction ID at the same moment are serialised by an advisory lock.
   * Cancelled bills do not count: a mistaken bill can be cancelled and re-billed on the same payment.
   */
  private async assertReferencesUnused(tx: Tx, applied: { mode: PaymentMode; reference: string | null }[], exceptSaleId?: bigint) {
    for (const p of applied) {
      if (!p.reference || p.mode === PaymentMode.CASH) continue;
      const key = `${p.mode}:${p.reference.toUpperCase()}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      const clash = await tx.salePayment.findFirst({
        where: { mode: p.mode, reference: { equals: p.reference, mode: 'insensitive' }, sale: { status: SaleStatus.COMPLETED, ...(exceptSaleId ? { id: { not: exceptSaleId } } : {}) } },
        include: { sale: { select: { billNo: true } } },
      });
      if (clash) throw new ConflictException(`${p.mode} transaction ${p.reference} was already used on bill ${clash.sale.billNo}`);
    }
  }

  private itemCreates(lines: PreparedLine[], totals: ReturnType<typeof calcSale>) {
    return lines.map((l, i) => ({
      lineNo: i + 1,
      productId: l.productId,
      kitId: l.kitId,
      codeSnapshot: l.code,
      nameSnapshot: l.name,
      qty: l.qty,
      rate: l.rate,
      masterRate: l.masterRate,
      discount: totals.lines[i].discount,
      gstRate: l.gstRate,
      taxAmount: totals.lines[i].tax,
      lineTotal: totals.lines[i].lineTotal,
      costAtSale: l.unitCost,
      components: l.components.length ? { create: l.components.map((c) => ({ productId: c.productId, qtyPerKit: c.qtyPerKit, gstRate: c.gstRate, unitCost: c.unitCost })) } : undefined,
    }));
  }

  /** Save a bill (FR-01, UR-5). Safe to retry: the same Idempotency-Key always returns the same bill. */
  async create(input: SaleInputT, user: SessionUser, idempotencyKey: string) {
    if (!user.counterId || !user.counterCode) throw new BadRequestException('Log in at a counter to make bills');
    const existing = await this.prisma.sale.findUnique({ where: { idempotencyKey } });
    if (existing) return this.replay(existing.id, user);

    const settings = await this.settings.get();
    const lines = await this.prepareLines(input.items, user);
    const { totals, settlement } = this.compute(lines, input.payments, settings);
    const priceOverride = this.overrideCheck(lines, input.remarks);

    if (input.heldBillId) {
      const held = await this.prisma.heldBill.findUnique({ where: { id: input.heldBillId } });
      if (!held || held.counterId !== user.counterId) throw new BadRequestException('That held bill belongs to another counter or was already recalled');
    }

    let warnings: StockWarning[] = [];
    try {
      const sale = await this.prisma.$transaction(
        async (tx) => {
          await this.assertReferencesUnused(tx, settlement.applied);
          const billNo = await nextBillNo(tx, user.counterCode!);
          const sale = await tx.sale.create({
            data: {
              billNo,
              counterId: user.counterId!,
              userId: user.id,
              itemsTotal: totals.itemsTotal,
              discountTotal: totals.discountTotal,
              taxTotal: totals.taxTotal,
              roundOff: totals.roundOff,
              grandTotal: totals.grandTotal,
              tendered: settlement.tendered,
              changeDue: settlement.changeDue,
              idempotencyKey,
              customerName: input.customerName ?? null,
              remarks: input.remarks ?? null,
              priceOverride,
              items: { create: this.itemCreates(lines, totals) },
              payments: { create: settlement.applied.map((p) => ({ mode: p.mode, amount: p.amount, reference: p.reference })) },
            },
          });
          if (priceOverride) {
            await this.audit.log(
              { userId: user.id, action: 'PRICE_OVERRIDE', entity: 'sale', entityId: sale.id, after: { billNo, remarks: input.remarks, lines: lines.filter((l) => !l.rate.eq(l.masterRate)).map((l) => ({ name: l.name, qty: l.qty, master: l.masterRate, billed: l.rate })) } },
              tx,
            );
          }
          if (input.heldBillId) await tx.heldBill.deleteMany({ where: { id: input.heldBillId, counterId: user.counterId! } });
          // Stock last, so the shared balance rows are locked for the shortest possible time.
          warnings = await applyMovements(tx, this.movementsFor(lines, -1, MovementKind.SALE, 'SALE', sale.id), user.id, { blockNegative: settings.blockNegativeStock });
          return sale;
        },
        { maxWait: 10_000, timeout: 20_000 },
      );
      return {
        id: sale.id,
        billNo: sale.billNo,
        grandTotal: sale.grandTotal,
        changeDue: sale.changeDue,
        receiptUrl: `/api/v1/sales/${sale.id}/receipt?format=html`,
        warnings,
      };
    } catch (e) {
      // A retry raced the first attempt: return the bill that won.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && String(e.meta?.target).includes('idempotency')) {
        const won = await this.prisma.sale.findUnique({ where: { idempotencyKey } });
        if (won) return this.replay(won.id, user);
      }
      throw e;
    }
  }

  private async replay(id: bigint, user: SessionUser) {
    const sale = await this.prisma.sale.findUniqueOrThrow({ where: { id } });
    if (sale.userId !== user.id) throw new ConflictException('This bill key was already used by another user');
    return { id: sale.id, billNo: sale.billNo, grandTotal: sale.grandTotal, changeDue: sale.changeDue, receiptUrl: `/api/v1/sales/${sale.id}/receipt?format=html`, warnings: [], replayed: true };
  }

  /** Lock a bill row for the rest of the transaction and check it can still be changed. */
  private async lockForChange(tx: Tx, id: bigint, what: string) {
    await tx.$queryRaw`SELECT id FROM sale WHERE id = ${id} FOR UPDATE`;
    const sale = await tx.sale.findUnique({ where: { id }, include: { items: { include: { components: true } }, payments: true, returns: true } });
    if (!sale) throw new NotFoundException('Bill not found');
    if (sale.status !== SaleStatus.COMPLETED) throw new ConflictException(`This bill is already cancelled and cannot be ${what}`);
    if (!isSameIstDay(sale.billedAt)) throw new ForbiddenException(`Only today's bills can be ${what}. Use a sales return for older bills.`);
    if (sale.returns.length > 0) throw new ConflictException(`This bill has returns against it and cannot be ${what}`);
    return sale;
  }

  private priorLines(sale: Prisma.SaleGetPayload<{ include: { items: { include: { components: true } } } }>) {
    return sale.items.map((i) => ({
      productId: i.productId,
      qty: D(i.qty),
      unitCost: D(i.costAtSale),
      components: i.components.map((c) => ({ productId: c.productId, qtyPerKit: D(c.qtyPerKit), unitCost: D(c.unitCost) })),
    }));
  }

  /** Manager edit, same day only (FR-03, R7). The old lines are reversed and the new ones applied; audited. */
  async edit(id: bigint, input: SaleInputT, user: SessionUser, ip: string) {
    const settings = await this.settings.get();
    const lines = await this.prepareLines(input.items, user);
    const { totals, settlement } = this.compute(lines, input.payments, settings);
    const priceOverride = this.overrideCheck(lines, input.remarks);
    let warnings: StockWarning[] = [];
    await this.prisma.$transaction(
      async (tx) => {
        const before = await this.lockForChange(tx, id, 'edited');
        await this.assertReferencesUnused(tx, settlement.applied, id);
        await applyMovements(tx, this.movementsFor(this.priorLines(before), 1, MovementKind.CANCEL, 'SALE', id, 'Bill edit: old lines reversed'), user.id, { blockNegative: false });
        await tx.saleItem.deleteMany({ where: { saleId: id } });
        await tx.salePayment.deleteMany({ where: { saleId: id } });
        const after = await tx.sale.update({
          where: { id },
          data: {
            itemsTotal: totals.itemsTotal,
            discountTotal: totals.discountTotal,
            taxTotal: totals.taxTotal,
            roundOff: totals.roundOff,
            grandTotal: totals.grandTotal,
            tendered: settlement.tendered,
            changeDue: settlement.changeDue,
            customerName: input.customerName ?? before.customerName,
            remarks: input.remarks ?? before.remarks,
            priceOverride,
            editedAt: new Date(),
            editCount: { increment: 1 },
            items: { create: this.itemCreates(lines, totals) },
            payments: { create: settlement.applied.map((p) => ({ mode: p.mode, amount: p.amount, reference: p.reference })) },
          },
          include: { items: true, payments: true },
        });
        warnings = await applyMovements(tx, this.movementsFor(lines, -1, MovementKind.SALE, 'SALE', id, 'Bill edit: new lines'), user.id, { blockNegative: settings.blockNegativeStock });
        await this.audit.log(
          { userId: user.id, action: 'SALE_EDIT', entity: 'sale', entityId: id, ip, before: { billNo: before.billNo, grandTotal: before.grandTotal, items: before.items, payments: before.payments }, after: { grandTotal: after.grandTotal, items: after.items, payments: after.payments } },
          tx,
        );
      },
      { maxWait: 10_000, timeout: 20_000 },
    );
    return { ...(await this.detail(id, user)), warnings };
  }

  /** Manager cancel, same day only, with a reason. Stock is put back with reversing movements; nothing is deleted. */
  async cancel(id: bigint, reason: string, user: SessionUser, ip: string) {
    await this.prisma.$transaction(async (tx) => {
      const sale = await this.lockForChange(tx, id, 'cancelled');
      await applyMovements(tx, this.movementsFor(this.priorLines(sale), 1, MovementKind.CANCEL, 'SALE', id, `Bill cancelled: ${reason}`), user.id, { blockNegative: false });
      await tx.sale.update({ where: { id }, data: { status: SaleStatus.CANCELLED, cancelReason: reason, cancelledById: user.id, cancelledAt: new Date() } });
      await this.audit.log({ userId: user.id, action: 'SALE_CANCEL', entity: 'sale', entityId: id, ip, before: { status: sale.status, grandTotal: sale.grandTotal }, after: { status: 'CANCELLED', reason } }, tx);
    });
    return this.detail(id, user);
  }

  /** Sales return against the original bill (FR-13). */
  async createReturn(saleId: bigint, input: z.infer<typeof ReturnInput>, user: SessionUser, ip: string) {
    const settings = await this.settings.get();
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM sale WHERE id = ${saleId} FOR UPDATE`;
      const sale = await tx.sale.findUnique({
        where: { id: saleId },
        include: { payments: true, items: { include: { components: true, returnLines: true, product: { include: { unit: true } } } } },
      });
      if (!sale) throw new NotFoundException('Bill not found');
      if (sale.status !== SaleStatus.COMPLETED) throw new ConflictException('A cancelled bill cannot have returns');
      const ageDays = (Date.now() - sale.billedAt.getTime()) / 86_400_000;
      if (settings.returnWindowDays > 0 && ageDays > settings.returnWindowDays) {
        throw new ForbiddenException(`Returns are accepted up to ${settings.returnWindowDays} days after the bill (this bill is ${Math.floor(ageDays)} days old)`);
      }
      // Money goes back the way it came: a UPI bill is refunded by UPI, not from the cash drawer.
      const paidModes = new Set(sale.payments.map((p) => p.mode));
      if (paidModes.size > 0 && !paidModes.has(input.refundMode)) {
        throw new BadRequestException(`This bill was paid by ${[...paidModes].join(' and ')}, so the refund must go back the same way`);
      }
      const ids = input.items.map((i) => i.saleItemId);
      if (new Set(ids).size !== ids.length) throw new BadRequestException('Each bill line can appear only once in a return');

      const lines: { saleItemId: number; qty: Dec; amount: Dec }[] = [];
      const moves: Movement[] = [];
      for (const r of input.items) {
        const item = sale.items.find((i) => i.id === r.saleItemId);
        if (!item) throw new BadRequestException('A return line does not belong to this bill');
        const qty = D(r.qty);
        const sold = D(item.qty);
        const alreadyQty = sum(item.returnLines.map((x) => D(x.qty)));
        const alreadyAmt = sum(item.returnLines.map((x) => D(x.amount)));
        const left = sold.minus(alreadyQty);
        if (qty.gt(left)) throw new BadRequestException(`${item.nameSnapshot}: only ${left.toString()} can still be returned`);
        if ((item.kitId || (item.product && !item.product.unit.allowDecimal)) && !qty.isInteger()) {
          throw new BadRequestException(`${item.nameSnapshot}: return a whole number`);
        }
        // The last return of a line refunds exactly what is left, so refunds never drift from the bill.
        const amount = qty.eq(left) ? D(item.lineTotal).minus(alreadyAmt) : round2(D(item.lineTotal).div(sold).mul(qty));
        lines.push({ saleItemId: item.id, qty, amount });
        if (item.productId) moves.push({ productId: item.productId, kind: MovementKind.SALE_RETURN, qty, unitCost: D(item.costAtSale), refType: 'SALES_RETURN', refId: 0 });
        for (const c of item.components) moves.push({ productId: c.productId, kind: MovementKind.SALE_RETURN, qty: qty.mul(c.qtyPerKit), unitCost: D(c.unitCost), refType: 'SALES_RETURN', refId: 0 });
      }
      let total = sum(lines.map((l) => l.amount));
      // When this return empties the whole bill, hand back the round-off too, so the refund equals what was paid.
      const fullyReturned = sale.items.every((it) => {
        const now = lines.find((l) => l.saleItemId === it.id)?.qty ?? D(0);
        return sum(it.returnLines.map((x) => D(x.qty))).plus(now).eq(D(it.qty));
      });
      if (fullyReturned) total = total.plus(D(sale.roundOff));

      const returnNo = await nextDocNo(tx, 'SR');
      const ret = await tx.salesReturn.create({
        data: { returnNo, saleId, userId: user.id, reason: input.reason, refundMode: input.refundMode, total, items: { create: lines } },
        include: { items: true },
      });
      const warnings = await applyMovements(tx, moves.map((m) => ({ ...m, refId: ret.id })), user.id, { blockNegative: settings.blockNegativeStock });
      await this.audit.log({ userId: user.id, action: 'SALES_RETURN', entity: 'sale', entityId: saleId, ip, after: { returnNo, total, lines } }, tx);
      return { ...ret, warnings };
    });
  }

  // ---------- Held bills (FR-02) ----------

  /** Every hold and every discarded hold is logged, so "ring it up, take the cash, delete the hold" leaves a trail. */
  async hold(user: SessionUser, label: string | undefined, payload: unknown, ip: string) {
    if (!user.counterId) throw new BadRequestException('Log in at a counter to hold bills');
    const json = JSON.stringify(payload ?? {});
    if (json.length > 200_000) throw new BadRequestException('The held bill is too large');
    const count = await this.prisma.heldBill.count({ where: { counterId: user.counterId } });
    if (count >= 30) throw new ConflictException('This counter already has 30 held bills. Recall or clear some first.');
    const held = await this.prisma.heldBill.create({
      data: { counterId: user.counterId, userId: user.id, label: (label ?? '').trim().slice(0, 60) || `Held ${new Date().toISOString().slice(11, 16)}`, payload: JSON.parse(json) },
    });
    await this.audit.log({ userId: user.id, action: 'HOLD_CREATE', entity: 'held_bill', entityId: held.id, ip, after: this.holdSummary(held.payload) });
    return held;
  }

  private holdSummary(payload: unknown) {
    const p = payload as { lines?: { name?: string; qty?: number; rate?: number; discount?: number }[] } | null;
    const lines = Array.isArray(p?.lines) ? p!.lines! : [];
    return {
      lines: lines.length,
      total: Number(lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.rate) || 0) - (Number(l.discount) || 0), 0).toFixed(2)),
      items: lines.slice(0, 20).map((l) => `${l.qty ?? ''} x ${l.name ?? ''}`),
    };
  }

  listHeld(user: SessionUser) {
    if (!user.counterId) return [];
    return this.prisma.heldBill.findMany({ where: { counterId: user.counterId }, orderBy: { createdAt: 'asc' }, include: { user: { select: { fullName: true } } } });
  }

  /** A cashier may discard only their own holds; a manager may discard any on the counter. */
  async deleteHeld(id: number, user: SessionUser, ip: string) {
    const held = await this.prisma.heldBill.findFirst({ where: { id, counterId: user.counterId ?? -1 } });
    if (!held) throw new NotFoundException('Held bill not found on this counter');
    if (held.userId !== user.id && !MANAGERS.includes(user.role)) throw new ForbiddenException('Only the cashier who held this bill, or a manager, can discard it');
    await this.prisma.heldBill.delete({ where: { id } });
    await this.audit.log({ userId: user.id, action: 'HOLD_DISCARD', entity: 'held_bill', entityId: id, ip, before: { ...this.holdSummary(held.payload), heldBy: held.userId, label: held.label } });
    return { ok: true };
  }

  /**
   * Receipt for printing. The first print is the original; every later one is stamped DUPLICATE with
   * its number and logged, so a bill cannot be printed over and over to hand out as fresh "originals".
   */
  async receiptFor(id: bigint, user: SessionUser, ip: string) {
    await this.detail(id, user); // applies the cashier scope
    const sale = await this.prisma.$transaction(async (tx) => {
      const s = await tx.sale.update({
        where: { id },
        data: { printCount: { increment: 1 } },
        include: { counter: true, user: { select: { fullName: true } }, items: { orderBy: { lineNo: 'asc' } }, payments: true },
      });
      if (s.printCount > 1) await this.audit.log({ userId: user.id, action: 'RECEIPT_REPRINT', entity: 'sale', entityId: id, ip, after: { billNo: s.billNo, printNo: s.printCount } }, tx);
      return s;
    });
    return { sale, stamp: sale.printCount > 1 ? `DUPLICATE ${sale.printCount - 1}` : null };
  }

  // ---------- Register and detail (FR-03) ----------

  /** Cashiers only see their own bills from today. */
  private scope(user: SessionUser): Prisma.SaleWhereInput {
    if (user.role !== Role.CASHIER) return {};
    const { start, end } = istRange(istDate(), istDate());
    return { userId: user.id, billedAt: { gte: start, lt: end } };
  }

  async list(q: { from: string; to: string; counterId?: number; userId?: number; status?: SaleStatus; q?: string; page: number; pageSize: number }, user: SessionUser) {
    const { start, end } = istRange(q.from, q.to);
    const where: Prisma.SaleWhereInput = {
      AND: [
        { billedAt: { gte: start, lt: end } },
        q.counterId ? { counterId: q.counterId } : {},
        q.userId ? { userId: q.userId } : {},
        q.status ? { status: q.status } : {},
        q.q ? { OR: [{ billNo: { contains: q.q, mode: 'insensitive' } }, { customerName: { contains: q.q, mode: 'insensitive' } }] } : {},
        this.scope(user),
      ],
    };
    const [rows, total, agg] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        orderBy: { billedAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { counter: { select: { code: true } }, user: { select: { fullName: true } }, payments: true, _count: { select: { items: true, returns: true } } },
      }),
      this.prisma.sale.count({ where }),
      this.prisma.sale.aggregate({ where: { AND: [where, { status: SaleStatus.COMPLETED }] }, _sum: { grandTotal: true }, _count: true }),
    ]);
    return {
      rows: rows.map((s) => ({
        id: s.id, billNo: s.billNo, billedAt: s.billedAt, counter: s.counter.code, cashier: s.user.fullName, status: s.status,
        grandTotal: s.grandTotal, itemCount: s._count.items, hasReturns: s._count.returns > 0, edited: s.editCount > 0,
        printCount: s.printCount, priceOverride: s.priceOverride,
        payModes: [...new Set(s.payments.map((p) => p.mode))].join('+'), customerName: s.customerName,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
      completedTotal: agg._sum.grandTotal ?? 0,
      completedCount: agg._count,
    };
  }

  async detail(id: bigint, user: SessionUser) {
    const sale = await this.prisma.sale.findFirst({
      where: { AND: [{ id }, this.scope(user)] },
      include: {
        counter: true,
        user: { select: { id: true, fullName: true, username: true } },
        cancelledBy: { select: { fullName: true } },
        items: { orderBy: { lineNo: 'asc' }, include: { components: { include: { product: { select: { code: true, name: true } } } }, returnLines: true } },
        payments: true,
        returns: { include: { items: true, user: { select: { fullName: true } } }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!sale) throw new NotFoundException('Bill not found');
    const today = isSameIstDay(sale.billedAt);
    const isManager = MANAGERS.includes(user.role);
    return {
      ...sale,
      items: sale.items.map((i) => ({ ...i, returnedQty: sum(i.returnLines.map((r) => D(r.qty))) })),
      can: {
        edit: isManager && today && sale.status === 'COMPLETED' && sale.returns.length === 0,
        cancel: isManager && today && sale.status === 'COMPLETED' && sale.returns.length === 0,
        return: isManager && sale.status === 'COMPLETED',
      },
    };
  }

  async lastBillOfCounter(user: SessionUser) {
    if (!user.counterId) throw new BadRequestException('Not logged in at a counter');
    const s = await this.prisma.sale.findFirst({ where: { counterId: user.counterId, ...this.scope(user) }, orderBy: { billedAt: 'desc' }, select: { id: true, billNo: true } });
    if (!s) throw new NotFoundException('No bills on this counter yet');
    return s;
  }
}
