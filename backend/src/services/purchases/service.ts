import { Loaded, Tx, Where, invoiceKey, withTx } from '../../config/db';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Role } from '../../models/auth/model';
import { EntryUnit, Purchase, PurchaseStatus } from '../../models/purchases/model';
import { MovementKind } from '../../models/stock/model';
import { z } from 'zod';
import { SessionUser } from '../../middleware/auth.decorators';
import { AuditService } from '../audit/service';
import { nextDocNo } from '../../utils/doc-number';
import { D, Dec, num, round2, sum } from '../../utils/money';
import { SettingsService } from '../settings/service';
import { applyMovements, Movement } from '../../utils/stock-ledger';
import { istRange } from '../../utils/time';
import { zMoney, zOptText } from '../../validators/validate';
import { DbService } from '../../config/db';
import { calcPurchase, PurchaseCalcError } from '../../utils/purchase-calc';
import { PurchaseHeader, PurchaseLine, PurchaseReturnInput } from '../../validators/purchases/validator';

const MANAGERS: Role[] = [Role.ADMIN, Role.MANAGER];



export const PurchaseDraft = PurchaseHeader.extend({
  lines: z.array(PurchaseLine).max(300),
  charges: z
    .array(z.object({ chargeTypeId: z.coerce.number().int().positive(), amount: zMoney, paidTo: zOptText(80), referenceNo: zOptText(40) }))
    .max(20)
    .default([]),
  billDiscount: zMoney.default(0),
  invoiceTotal: zMoney.optional().nullable(),
});

const fullInclude = {
  supplier: true,
  createdBy: { select: { fullName: true } },
  postedBy: { select: { fullName: true } },
  readyBy: { select: { fullName: true } },
  items: { orderBy: { lineNo: 'asc' as const }, include: { product: { include: { unit: true, packUnit: true } }, returnLines: true } },
  charges: { include: { chargeType: true } },
  returns: { include: { items: true, user: { select: { fullName: true } } } },
};

@Injectable()
export class PurchaseService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  private async loadSupplier(id: number) {
    const s = await this.db.supplier.findUnique({ where: { id } });
    if (!s) throw new BadRequestException('Supplier not found');
    if (!s.isActive) throw new BadRequestException(`${s.name} is switched off`);
    return s;
  }

  async createDraft(input: z.infer<typeof PurchaseHeader>, user: SessionUser) {
    await this.loadSupplier(input.supplierId);
    await this.assertInvoiceFree(input.supplierId, input.supplierInvoiceNo);
    // The GRN number is given the moment the bill is first saved, so it can be written on the supplier bill.
    const p = await withTx(this.db, async (tx) =>
      tx.purchase.create({
        data: {
          purchaseNo: await nextDocNo(tx, 'GRN'),
          supplierId: input.supplierId,
          supplierInvoiceNo: input.supplierInvoiceNo,
          invoiceDate: new Date(`${input.invoiceDate}T00:00:00Z`),
          taxInclusive: input.taxInclusive,
          notes: input.notes ?? null,
          invoiceTotal: input.invoiceTotal === null || input.invoiceTotal === undefined ? null : num(input.invoiceTotal),
          createdById: user.id,
        },
      }),
    );
    return this.detail(p.id);
  }

  private async assertInvoiceFree(supplierId: number, invoiceNo: string, exceptId?: number) {
    const clash = await this.db.purchase.findFirst({
      where: {
        supplierId,
        invoiceKey: invoiceKey(invoiceNo),
        status: { not: PurchaseStatus.CANCELLED },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
    });
    if (clash) {
      throw new ConflictException(`Invoice ${invoiceNo} from this supplier is already entered${clash.purchaseNo ? ` as ${clash.purchaseNo}` : ' as a draft'}${clash.status === 'DRAFT' ? ' (not posted yet)' : ''}`);
    }
  }

  /** Save the whole draft and return the computed totals and the difference from the supplier bill. */
  async saveDraft(id: number, input: z.infer<typeof PurchaseDraft>, user: SessionUser) {
    const settings = await this.settings.get();
    await this.loadSupplier(input.supplierId);
    await this.assertInvoiceFree(input.supplierId, input.supplierInvoiceNo, id);

    const productIds = [...new Set(input.lines.map((l) => l.productId))];
    const products = await this.db.product.findMany({ where: { id: { in: productIds } }, include: { unit: true } });
    const pMap = new Map(products.map((p) => [p.id, p]));
    const chargeTypes = await this.db.chargeType.findMany({ where: { id: { in: input.charges.map((c) => c.chargeTypeId) } } });
    const ctMap = new Map(chargeTypes.map((c) => [c.id, c]));

    const prepared = input.lines.map((l, i) => {
      const p = pMap.get(l.productId);
      if (!p) throw new BadRequestException(`Line ${i + 1}: product not found`);
      if (!p.isActive) throw new BadRequestException(`Line ${i + 1}: ${p.name} is switched off`);
      const packSize = l.entryUnit === EntryUnit.PACK ? D(p.packSize) : D(1);
      const enteredQty = D(l.enteredQty);
      const baseQty = enteredQty.mul(packSize);
      if (!p.unit.allowDecimal && !baseQty.isInteger()) throw new BadRequestException(`Line ${i + 1}: ${p.name} works out to ${baseQty.toString()} ${p.unit.code}; it must be a whole number`);
      if (l.expiry && l.expiry < input.invoiceDate) throw new BadRequestException(`Line ${i + 1}: expiry date is before the invoice date`);
      const mrp = l.mrp ?? (p.mrp === null ? null : Number(p.mrp));
      if (l.salePrice !== null && l.salePrice !== undefined && mrp !== null && l.salePrice > mrp) {
        throw new BadRequestException(`Line ${i + 1}: sale price ${l.salePrice} is above the MRP ${mrp} for ${p.name}`);
      }
      if (l.mrp !== null && l.mrp !== undefined && (l.salePrice === null || l.salePrice === undefined) && D(p.salePrice).gt(l.mrp)) {
        throw new BadRequestException(`Line ${i + 1}: the new MRP ${l.mrp} is below the current sale price ${D(p.salePrice).toFixed(2)}. Enter a new sale price too.`);
      }
      return { p, l, packSize, enteredQty, baseQty, gstRate: D(l.gstRate ?? p.gstRate) };
    });
    for (const c of input.charges) {
      const ct = ctMap.get(c.chargeTypeId);
      if (!ct) throw new BadRequestException('A charge type does not exist');
    }

    const totals = this.calc(
      prepared.map((x) => ({ enteredQty: x.enteredQty, baseQty: x.baseQty, rate: x.l.rate === null || x.l.rate === undefined ? null : D(x.l.rate), amount: x.l.amount === null || x.l.amount === undefined ? null : D(x.l.amount), discount: D(x.l.discount), gstRate: x.gstRate })),
      input.charges.map((c) => ({ amount: D(c.amount), addsToCost: ctMap.get(c.chargeTypeId)!.addsToCost, allocation: ctMap.get(c.chargeTypeId)!.allocation })),
      D(input.billDiscount),
      input.invoiceTotal === null || input.invoiceTotal === undefined ? null : D(input.invoiceTotal),
      input.taxInclusive,
      settings.gstMode === 'REGISTERED',
    );

    await withTx(this.db, async (tx) => {
      const cur = await this.lockDraft(tx, id);
      if (cur.createdById !== user.id && !MANAGERS.includes(user.role)) {
        throw new ForbiddenException('Only the person who started this draft or a manager can change it');
      }
      await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });
      await tx.purchaseCharge.deleteMany({ where: { purchaseId: id } });
      await tx.purchase.update({
        where: { id },
        data: {
          ...(cur.purchaseNo ? {} : { purchaseNo: await nextDocNo(tx, 'GRN') }), // drafts from before GRN numbering
          supplierId: input.supplierId,
          supplierInvoiceNo: input.supplierInvoiceNo,
          invoiceDate: new Date(`${input.invoiceDate}T00:00:00Z`),
          taxInclusive: input.taxInclusive,
          notes: input.notes ?? null,
          readyAt: null, // any change needs a fresh "ready" from the store keeper
          readyById: null,
          itemsTotal: num(totals.itemsTotal),
          taxTotal: num(totals.taxTotal),
          chargesTotal: num(totals.chargesTotal),
          discountTotal: num(totals.discountTotal),
          roundOff: num(totals.roundOff),
          grandTotal: num(totals.grandTotal),
          invoiceTotal: input.invoiceTotal === null || input.invoiceTotal === undefined ? null : num(input.invoiceTotal),
          items: {
            create: prepared.map((x, i) => ({
              lineNo: i + 1,
              productId: x.p.id,
              entryUnit: x.l.entryUnit,
              enteredQty: num(x.enteredQty),
              packSize: num(x.packSize),
              baseQty: num(x.baseQty),
              rate: num(totals.lines[i].rate),
              grossAmount: num(totals.lines[i].grossAmount),
              discount: num(totals.lines[i].discount),
              gstRate: num(x.gstRate),
              taxAmount: num(totals.lines[i].taxAmount),
              lineTotal: num(totals.lines[i].lineTotal),
              landedUnitCost: num(totals.lines[i].landedUnitCost),
              batch: x.l.batch ?? null,
              expiry: x.l.expiry ? new Date(`${x.l.expiry}T00:00:00Z`) : null,
              salePrice: x.l.salePrice === null || x.l.salePrice === undefined ? null : num(x.l.salePrice),
              mrp: x.l.mrp === null || x.l.mrp === undefined ? null : num(x.l.mrp),
            })),
          },
          charges: { create: input.charges.map((c) => ({ chargeTypeId: c.chargeTypeId, amount: num(c.amount), paidTo: c.paidTo ?? null, referenceNo: c.referenceNo ?? null })) },
        },
      });
    });
    return this.detail(id);
  }

  private calc(
    lines: Parameters<typeof calcPurchase>[0]['lines'],
    charges: Parameters<typeof calcPurchase>[0]['charges'],
    billDiscount: Dec,
    invoiceTotal: Dec | null,
    taxInclusive: boolean,
    gstRegistered: boolean,
  ) {
    try {
      return calcPurchase({ lines, charges, billDiscount, invoiceTotal, taxInclusive, gstRegistered });
    } catch (e) {
      if (e instanceof PurchaseCalcError) throw new BadRequestException(e.message);
      throw e;
    }
  }

  /**
   * Claim the purchase document for this transaction (MongoDB has no SELECT … FOR UPDATE): a write to it
   * makes any other transaction that writes the same purchase conflict, and withTx re-runs that one,
   * which then sees the new state (posted, cancelled, …).
   */
  private async claim(tx: Tx, id: number) {
    await tx.purchase.updateMany({ where: { id }, data: { updatedAt: new Date() } });
  }

  private async lockDraft(tx: Tx, id: number) {
    await this.claim(tx, id);
    const cur = await tx.purchase.findUnique({ where: { id } });
    if (!cur) throw new NotFoundException('Purchase not found');
    if (cur.status !== PurchaseStatus.DRAFT) throw new ConflictException('This purchase is already posted and cannot be changed');
    return cur;
  }

  /** Recompute a stored purchase with the current charge-type rules. */
  private async computeStored(p: Loaded<Purchase>) {
    const s = await this.settings.get();
    return calcPurchase({
      lines: p.items.map((i) => ({ enteredQty: D(i.enteredQty), baseQty: D(i.baseQty), amount: D(i.grossAmount), discount: D(i.discount), gstRate: D(i.gstRate) })),
      charges: p.charges.map((c) => ({ amount: D(c.amount), addsToCost: c.chargeType.addsToCost, allocation: c.chargeType.allocation })),
      billDiscount: D(p.discountTotal),
      invoiceTotal: p.invoiceTotal === null ? null : D(p.invoiceTotal),
      taxInclusive: p.taxInclusive,
      gstRegistered: s.gstMode === 'REGISTERED',
    });
  }

  /** Post (FR-06): blocked unless the computed total is within Rs 1 of the supplier bill. Then stock goes up at landed cost. */
  async post(id: number, user: SessionUser, ip: string) {
    await withTx(this.db, 
      async (tx) => {
        await this.lockDraft(tx, id);
        const p = await tx.purchase.findUniqueOrThrow({ where: { id }, include: fullInclude });
        if (p.items.length === 0) throw new UnprocessableEntityException({ message: 'Add at least one item before posting', code: 'NO_ITEMS' });
        for (const i of p.items) if (!i.product.isActive) throw new UnprocessableEntityException(`${i.product.name} is switched off`);
        for (const c of p.charges) if (!c.chargeType.isActive) throw new UnprocessableEntityException(`Charge type ${c.chargeType.name} is switched off`);
        const t = await this.computeStored(p);
        if (!t.canPost) {
          throw new UnprocessableEntityException({
            message: t.problem ?? 'Totals do not match',
            code: 'TOTAL_MISMATCH',
            computedTotal: Number(t.computedTotal),
            invoiceTotal: p.invoiceTotal === null ? null : Number(p.invoiceTotal),
            difference: t.difference === null ? null : Number(t.difference),
          });
        }
        const purchaseNo = p.purchaseNo ?? (await nextDocNo(tx, 'GRN'));
        for (let i = 0; i < p.items.length; i++) {
          await tx.purchaseItem.update({ where: { id: p.items[i].id }, data: { landedUnitCost: num(t.lines[i].landedUnitCost), rate: num(t.lines[i].rate) } });
        }
        // Latest landed cost becomes the product's cost (the last line wins when one product appears twice).
        for (let i = 0; i < p.items.length; i++) {
          await tx.product.update({ where: { id: p.items[i].productId }, data: { lastCost: num(t.lines[i].landedUnitCost) } });
        }
        // New sale price / MRP typed on the GRN go to the product master (last line wins), each change audited.
        const priced = new Map<number, (typeof p.items)[number]>();
        for (const i of p.items) if (i.salePrice !== null || i.mrp !== null) priced.set(i.productId, i);
        for (const [productId, i] of priced) {
          const before = await tx.product.findUniqueOrThrow({ where: { id: productId }, select: { salePrice: true, mrp: true, name: true } });
          const salePrice = i.salePrice ?? before.salePrice;
          const mrp = i.mrp ?? before.mrp;
          if (mrp !== null && D(salePrice).gt(mrp)) {
            throw new UnprocessableEntityException(`${before.name}: sale price ${D(salePrice).toFixed(2)} would be above the MRP ${D(mrp).toFixed(2)}`);
          }
          if (D(salePrice).eq(before.salePrice) && String(mrp ?? '') === String(before.mrp ?? '')) continue;
          await tx.product.update({ where: { id: productId }, data: { salePrice, mrp } });
          await this.audit.log(
            { userId: user.id, action: 'PRICE_CHANGE', entity: 'product', entityId: productId, ip, before: { salePrice: before.salePrice, mrp: before.mrp }, after: { salePrice, mrp, via: purchaseNo } },
            tx,
          );
        }
        await tx.purchase.update({
          where: { id },
          data: {
            purchaseNo,
            status: PurchaseStatus.POSTED,
            postedAt: new Date(),
            postedById: user.id,
            itemsTotal: num(t.itemsTotal),
            taxTotal: num(t.taxTotal),
            chargesTotal: num(t.chargesTotal),
            discountTotal: num(t.discountTotal),
            roundOff: num(t.roundOff),
            grandTotal: num(t.grandTotal),
          },
        });
        await applyMovements(
          tx,
          p.items.map((i, idx) => ({ productId: i.productId, kind: MovementKind.PURCHASE, qty: D(i.baseQty), unitCost: t.lines[idx].landedUnitCost, refType: 'PURCHASE', refId: id })),
          user.id,
          { blockNegative: false },
        );
        await this.audit.log({ userId: user.id, action: 'PURCHASE_POST', entity: 'purchase', entityId: id, ip, after: { purchaseNo, grandTotal: t.grandTotal, roundOff: t.roundOff, invoiceTotal: p.invoiceTotal } }, tx);
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
    return this.detail(id);
  }

  /** Store keeper hands the draft to a manager. The totals must already match the supplier bill. */
  async markReady(id: number, user: SessionUser, ip: string) {
    await withTx(this.db, async (tx) => {
      await this.lockDraft(tx, id);
      const p = await tx.purchase.findUniqueOrThrow({ where: { id }, include: fullInclude });
      const t = await this.computeStored(p);
      if (p.items.length === 0) throw new UnprocessableEntityException('Add at least one item first');
      if (!t.canPost) throw new UnprocessableEntityException({ message: t.problem ?? 'Totals do not match the supplier bill', code: 'TOTAL_MISMATCH' });
      await tx.purchase.update({ where: { id }, data: { readyAt: new Date(), readyById: user.id } });
      await this.audit.log({ userId: user.id, action: 'PURCHASE_READY', entity: 'purchase', entityId: id, ip, after: { supplierInvoiceNo: p.supplierInvoiceNo, grandTotal: t.grandTotal } }, tx);
    });
    return this.detail(id);
  }

  async deleteDraft(id: number, user: SessionUser) {
    await withTx(this.db, async (tx) => {
      const cur = await this.lockDraft(tx, id);
      if (cur.createdById !== user.id && !([Role.ADMIN, Role.MANAGER] as Role[]).includes(user.role)) {
        throw new ForbiddenException('Only the person who started this draft or a manager can delete it');
      }
      await tx.purchase.delete({ where: { id } });
      await this.audit.log({ userId: user.id, action: 'PURCHASE_DRAFT_DELETE', entity: 'purchase', entityId: id, before: { supplierInvoiceNo: cur.supplierInvoiceNo, grnNo: cur.purchaseNo } }, tx);
    });
    return { ok: true };
  }

  /** Cancel a posted purchase (manager): stock taken back out with reversing movements. */
  async cancel(id: number, reason: string, user: SessionUser, ip: string) {
    const settings = await this.settings.get();
    await withTx(this.db, async (tx) => {
      await this.claim(tx, id);
      const p = await tx.purchase.findUnique({ where: { id }, include: { items: true, returns: true } });
      if (!p) throw new NotFoundException('Purchase not found');
      if (p.status !== PurchaseStatus.POSTED) throw new ConflictException('Only a posted purchase can be cancelled. Delete a draft instead.');
      if (p.returns.length) throw new ConflictException('This purchase has returns against it and cannot be cancelled');
      await applyMovements(
        tx,
        p.items.map((i) => ({ productId: i.productId, kind: MovementKind.CANCEL, qty: D(i.baseQty).neg(), unitCost: i.landedUnitCost, refType: 'PURCHASE', refId: id, note: `Purchase cancelled: ${reason}` })),
        user.id,
        { blockNegative: settings.blockNegativeStock },
      );
      await tx.purchase.update({ where: { id }, data: { status: PurchaseStatus.CANCELLED, cancelledAt: new Date(), cancelReason: reason } });
      // The product's cost goes back to its latest remaining posted purchase.
      for (const productId of new Set(p.items.map((i) => i.productId))) {
        // lines of this product on other purchases -> the most recently posted of those purchases
        const lines = await tx.purchaseItem.findMany({ where: { productId, purchaseId: { not: id } }, select: { purchaseId: true, landedUnitCost: true } });
        const latest = lines.length
          ? await tx.purchase.findFirst({ where: { id: { in: [...new Set(lines.map((l) => l.purchaseId))] }, status: PurchaseStatus.POSTED }, orderBy: { postedAt: 'desc' }, select: { id: true } })
          : null;
        const prev = latest ? lines.find((l) => l.purchaseId === latest.id) : undefined;
        await tx.product.update({ where: { id: productId }, data: { lastCost: prev?.landedUnitCost ?? null } });
      }
      await this.audit.log({ userId: user.id, action: 'PURCHASE_CANCEL', entity: 'purchase', entityId: id, ip, before: { status: p.status, purchaseNo: p.purchaseNo }, after: { status: 'CANCELLED', reason } }, tx);
    });
    return this.detail(id);
  }

  /** Return goods to the supplier against a posted purchase (FR-13). */
  async createReturn(id: number, input: z.infer<typeof PurchaseReturnInput>, user: SessionUser, ip: string) {
    const settings = await this.settings.get();
    return withTx(this.db, async (tx) => {
      await this.claim(tx, id);
      const p = await tx.purchase.findUnique({ where: { id }, include: { items: { include: { returnLines: true, product: { include: { unit: true } } } } } });
      if (!p) throw new NotFoundException('Purchase not found');
      if (p.status !== PurchaseStatus.POSTED) throw new ConflictException('Returns can only be made against a posted purchase');
      const ids = input.items.map((i) => i.purchaseItemId);
      if (new Set(ids).size !== ids.length) throw new BadRequestException('Each purchase line can appear only once in a return');
      const lines: { purchaseItemId: number; baseQty: Dec; amount: Dec }[] = [];
      const moves: Movement[] = [];
      for (const r of input.items) {
        const it = p.items.find((i) => i.id === r.purchaseItemId);
        if (!it) throw new BadRequestException('A return line does not belong to this purchase');
        const qty = D(r.baseQty);
        if (!it.product.unit.allowDecimal && !qty.isInteger()) throw new BadRequestException(`${it.product.name}: return a whole number of ${it.product.unit.code}`);
        const already = sum(it.returnLines.map((x) => D(x.baseQty)));
        const alreadyAmt = sum(it.returnLines.map((x) => D(x.amount)));
        const left = D(it.baseQty).minus(already);
        if (qty.gt(left)) throw new BadRequestException(`${it.product.name}: only ${left.toString()} ${it.product.unit.code} can still be returned`);
        const amount = qty.eq(left) ? D(it.lineTotal).minus(alreadyAmt) : round2(D(it.lineTotal).div(it.baseQty).mul(qty));
        lines.push({ purchaseItemId: it.id, baseQty: qty, amount });
        moves.push({ productId: it.productId, kind: MovementKind.PURCHASE_RETURN, qty: qty.neg(), unitCost: it.landedUnitCost, refType: 'PURCHASE_RETURN', refId: 0 });
      }
      const returnNo = await nextDocNo(tx, 'PR');
      const ret = await tx.purchaseReturn.create({
        data: { returnNo, purchaseId: id, supplierId: p.supplierId, userId: user.id, reason: input.reason, total: num(sum(lines.map((l) => l.amount))), items: { create: lines.map((l) => ({ purchaseItemId: l.purchaseItemId, baseQty: num(l.baseQty), amount: num(l.amount) })) } },
        include: { items: true },
      });
      const warnings = await applyMovements(tx, moves.map((m) => ({ ...m, refId: ret.id })), user.id, { blockNegative: settings.blockNegativeStock });
      await this.audit.log({ userId: user.id, action: 'PURCHASE_RETURN', entity: 'purchase', entityId: id, ip, after: { returnNo, total: ret.total, lines } }, tx);
      return { ...ret, warnings };
    });
  }

  async detail(id: number) {
    const p = await this.db.purchase.findUnique({ where: { id }, include: fullInclude });
    if (!p) throw new NotFoundException('Purchase not found');
    const t = await this.computeStored(p);
    return {
      ...p,
      invoiceDate: p.invoiceDate.toISOString().slice(0, 10),
      items: p.items.map((i, idx) => ({
        ...i,
        expiry: i.expiry ? i.expiry.toISOString().slice(0, 10) : null,
        returnedQty: sum(i.returnLines.map((r) => D(r.baseQty))),
        landedUnitCost: p.status === 'DRAFT' ? t.lines[idx]?.landedUnitCost ?? null : i.landedUnitCost,
      })),
      computed: {
        itemsTotal: t.itemsTotal,
        taxTotal: t.taxTotal,
        chargesTotal: t.chargesTotal,
        discountTotal: t.discountTotal,
        computedTotal: t.computedTotal,
        difference: t.difference,
        roundOff: t.roundOff,
        grandTotal: t.grandTotal,
        canPost: p.status === 'DRAFT' && t.canPost,
        problem: p.status === 'DRAFT' ? t.problem : null,
      },
    };
  }

  async list(q: { from?: string; to?: string; supplierId?: number; status?: PurchaseStatus; q?: string; page: number; pageSize: number }) {
    const where: Where = {
      AND: [
        q.from && q.to ? (() => { const r = istRange(q.from!, q.to!); return { OR: [{ postedAt: { gte: r.start, lt: r.end } }, { status: PurchaseStatus.DRAFT, createdAt: { gte: r.start, lt: r.end } }, { status: PurchaseStatus.CANCELLED, createdAt: { gte: r.start, lt: r.end } }] }; })() : {},
        q.supplierId ? { supplierId: q.supplierId } : {},
        q.status ? { status: q.status } : {},
        q.q ? { OR: [{ supplierInvoiceNo: { contains: q.q, mode: 'insensitive' } }, { purchaseNo: { contains: q.q, mode: 'insensitive' } }] } : {},
      ],
    };
    const [rows, total] = await Promise.all([
      this.db.purchase.findMany({
        where,
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { supplier: { select: { name: true } }, createdBy: { select: { fullName: true } }, _count: { select: { items: true } } },
      }),
      this.db.purchase.count({ where }),
    ]);
    return {
      rows: rows.map((p) => ({
        id: p.id, purchaseNo: p.purchaseNo, status: p.status, supplier: p.supplier.name, supplierInvoiceNo: p.supplierInvoiceNo,
        invoiceDate: p.invoiceDate.toISOString().slice(0, 10), grandTotal: p.grandTotal, invoiceTotal: p.invoiceTotal, itemCount: p._count.items,
        createdBy: p.createdBy.fullName, postedAt: p.postedAt, createdAt: p.createdAt, readyAt: p.readyAt,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }
}
