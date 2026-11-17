import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { EntryUnit, MovementKind, Prisma, PurchaseStatus, Role } from '@prisma/client';
import { z } from 'zod';
import { SessionUser } from '../auth/auth.decorators';
import { AuditService } from '../common/audit.service';
import { nextDocNo } from '../common/doc-number';
import { D, Dec, round2, sum } from '../common/money';
import { SettingsService } from '../common/settings.service';
import { applyMovements, Movement } from '../common/stock-ledger';
import { istDate, istRange } from '../common/time';
import { zDate, zGst, zMoney, zOptText, zQty, zRate4, zReason } from '../common/validate';
import { PrismaService } from '../prisma/prisma.service';
import { calcPurchase, PurchaseCalcError } from './purchase-calc';

const MANAGERS: Role[] = [Role.ADMIN, Role.MANAGER];

type Tx = Prisma.TransactionClient;

const notFuture = (d: string) => d <= istDate();

export const PurchaseHeader = z.object({
  supplierId: z.coerce.number().int().positive('Choose a supplier'),
  supplierInvoiceNo: z.string().trim().min(1, 'Enter the supplier invoice / DC number').max(40),
  invoiceDate: zDate.refine(notFuture, 'Invoice date cannot be in the future'),
  taxInclusive: z.boolean().default(true),
  notes: zOptText(300),
});

export const PurchaseLine = z
  .object({
    productId: z.coerce.number().int().positive(),
    entryUnit: z.nativeEnum(EntryUnit).default(EntryUnit.BASE),
    enteredQty: zQty,
    rate: zRate4.optional().nullable(),
    amount: zMoney.optional().nullable(),
    discount: zMoney.default(0),
    gstRate: zGst.optional().nullable(),
    batch: zOptText(30),
    expiry: zDate.optional().nullable(),
  })
  .refine((l) => (l.rate !== null && l.rate !== undefined) !== (l.amount !== null && l.amount !== undefined), {
    message: 'Enter either the rate or the line amount',
    path: ['rate'],
  });

export const PurchaseDraft = PurchaseHeader.extend({
  lines: z.array(PurchaseLine).max(300),
  charges: z
    .array(z.object({ chargeTypeId: z.coerce.number().int().positive(), amount: zMoney, paidTo: zOptText(80), referenceNo: zOptText(40) }))
    .max(20)
    .default([]),
  billDiscount: zMoney.default(0),
  invoiceTotal: zMoney.optional().nullable(),
});

export const PurchaseReturnInput = z.object({
  items: z.array(z.object({ purchaseItemId: z.coerce.number().int().positive(), baseQty: zQty })).min(1).max(300),
  reason: zReason,
});

const fullInclude = {
  supplier: true,
  createdBy: { select: { fullName: true } },
  postedBy: { select: { fullName: true } },
  readyBy: { select: { fullName: true } },
  items: { orderBy: { lineNo: 'asc' as const }, include: { product: { include: { unit: true, packUnit: true } }, returnLines: true } },
  charges: { include: { chargeType: true } },
  returns: { include: { items: true, user: { select: { fullName: true } } } },
} satisfies Prisma.PurchaseInclude;

@Injectable()
export class PurchaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  private async loadSupplier(id: number) {
    const s = await this.prisma.supplier.findUnique({ where: { id } });
    if (!s) throw new BadRequestException('Supplier not found');
    if (!s.isActive) throw new BadRequestException(`${s.name} is switched off`);
    return s;
  }

  async createDraft(input: z.infer<typeof PurchaseHeader>, user: SessionUser) {
    await this.loadSupplier(input.supplierId);
    await this.assertInvoiceFree(input.supplierId, input.supplierInvoiceNo);
    const p = await this.prisma.purchase.create({
      data: {
        supplierId: input.supplierId,
        supplierInvoiceNo: input.supplierInvoiceNo,
        invoiceDate: new Date(`${input.invoiceDate}T00:00:00Z`),
        taxInclusive: input.taxInclusive,
        notes: input.notes ?? null,
        createdById: user.id,
      },
    });
    return this.detail(p.id);
  }

  private async assertInvoiceFree(supplierId: number, invoiceNo: string, exceptId?: number) {
    const clash = await this.prisma.purchase.findFirst({
      where: {
        supplierId,
        supplierInvoiceNo: { equals: invoiceNo.trim(), mode: 'insensitive' },
        status: { not: PurchaseStatus.CANCELLED },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
    });
    if (clash) {
      throw new ConflictException(`Invoice ${invoiceNo} from this supplier is already entered${clash.purchaseNo ? ` as ${clash.purchaseNo}` : ' as a draft'}`);
    }
  }

  /** Save the whole draft and return the computed totals and the difference from the supplier bill. */
  async saveDraft(id: number, input: z.infer<typeof PurchaseDraft>, user: SessionUser) {
    const settings = await this.settings.get();
    await this.loadSupplier(input.supplierId);
    await this.assertInvoiceFree(input.supplierId, input.supplierInvoiceNo, id);

    const productIds = [...new Set(input.lines.map((l) => l.productId))];
    const products = await this.prisma.product.findMany({ where: { id: { in: productIds } }, include: { unit: true } });
    const pMap = new Map(products.map((p) => [p.id, p]));
    const chargeTypes = await this.prisma.chargeType.findMany({ where: { id: { in: input.charges.map((c) => c.chargeTypeId) } } });
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

    await this.prisma.$transaction(async (tx) => {
      const cur = await this.lockDraft(tx, id);
      if (cur.createdById !== user.id && !MANAGERS.includes(user.role)) {
        throw new ForbiddenException('Only the person who started this draft or a manager can change it');
      }
      await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });
      await tx.purchaseCharge.deleteMany({ where: { purchaseId: id } });
      await tx.purchase.update({
        where: { id },
        data: {
          supplierId: input.supplierId,
          supplierInvoiceNo: input.supplierInvoiceNo,
          invoiceDate: new Date(`${input.invoiceDate}T00:00:00Z`),
          taxInclusive: input.taxInclusive,
          notes: input.notes ?? null,
          readyAt: null, // any change needs a fresh "ready" from the store keeper
          readyById: null,
          itemsTotal: totals.itemsTotal,
          taxTotal: totals.taxTotal,
          chargesTotal: totals.chargesTotal,
          discountTotal: totals.discountTotal,
          roundOff: totals.roundOff,
          grandTotal: totals.grandTotal,
          invoiceTotal: input.invoiceTotal === null || input.invoiceTotal === undefined ? null : D(input.invoiceTotal),
          items: {
            create: prepared.map((x, i) => ({
              lineNo: i + 1,
              productId: x.p.id,
              entryUnit: x.l.entryUnit,
              enteredQty: x.enteredQty,
              packSize: x.packSize,
              baseQty: x.baseQty,
              rate: totals.lines[i].rate,
              grossAmount: totals.lines[i].grossAmount,
              discount: totals.lines[i].discount,
              gstRate: x.gstRate,
              taxAmount: totals.lines[i].taxAmount,
              lineTotal: totals.lines[i].lineTotal,
              landedUnitCost: totals.lines[i].landedUnitCost,
              batch: x.l.batch ?? null,
              expiry: x.l.expiry ? new Date(`${x.l.expiry}T00:00:00Z`) : null,
            })),
          },
          charges: { create: input.charges.map((c) => ({ chargeTypeId: c.chargeTypeId, amount: D(c.amount), paidTo: c.paidTo ?? null, referenceNo: c.referenceNo ?? null })) },
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

  private async lockDraft(tx: Tx, id: number) {
    await tx.$queryRaw`SELECT id FROM purchase WHERE id = ${id} FOR UPDATE`;
    const cur = await tx.purchase.findUnique({ where: { id } });
    if (!cur) throw new NotFoundException('Purchase not found');
    if (cur.status !== PurchaseStatus.DRAFT) throw new ConflictException('This purchase is already posted and cannot be changed');
    return cur;
  }

  /** Recompute a stored purchase with the current charge-type rules. */
  private async computeStored(p: Prisma.PurchaseGetPayload<{ include: typeof fullInclude }>) {
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
    await this.prisma.$transaction(
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
        const purchaseNo = await nextDocNo(tx, 'PU');
        for (let i = 0; i < p.items.length; i++) {
          await tx.purchaseItem.update({ where: { id: p.items[i].id }, data: { landedUnitCost: t.lines[i].landedUnitCost, rate: t.lines[i].rate } });
        }
        // Latest landed cost becomes the product's cost (the last line wins when one product appears twice).
        for (let i = 0; i < p.items.length; i++) {
          await tx.product.update({ where: { id: p.items[i].productId }, data: { lastCost: t.lines[i].landedUnitCost } });
        }
        await tx.purchase.update({
          where: { id },
          data: {
            purchaseNo,
            status: PurchaseStatus.POSTED,
            postedAt: new Date(),
            postedById: user.id,
            itemsTotal: t.itemsTotal,
            taxTotal: t.taxTotal,
            chargesTotal: t.chargesTotal,
            discountTotal: t.discountTotal,
            roundOff: t.roundOff,
            grandTotal: t.grandTotal,
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
    await this.prisma.$transaction(async (tx) => {
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
    await this.prisma.$transaction(async (tx) => {
      const cur = await this.lockDraft(tx, id);
      if (cur.createdById !== user.id && !([Role.ADMIN, Role.MANAGER] as Role[]).includes(user.role)) {
        throw new ForbiddenException('Only the person who started this draft or a manager can delete it');
      }
      await tx.purchase.delete({ where: { id } });
      await this.audit.log({ userId: user.id, action: 'PURCHASE_DRAFT_DELETE', entity: 'purchase', entityId: id, before: { supplierInvoiceNo: cur.supplierInvoiceNo } }, tx);
    });
    return { ok: true };
  }

  /** Cancel a posted purchase (manager): stock taken back out with reversing movements. */
  async cancel(id: number, reason: string, user: SessionUser, ip: string) {
    const settings = await this.settings.get();
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM purchase WHERE id = ${id} FOR UPDATE`;
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
        const prev = await tx.purchaseItem.findFirst({
          where: { productId, purchase: { status: PurchaseStatus.POSTED, id: { not: id } } },
          orderBy: { purchase: { postedAt: 'desc' } },
          select: { landedUnitCost: true },
        });
        await tx.product.update({ where: { id: productId }, data: { lastCost: prev?.landedUnitCost ?? null } });
      }
      await this.audit.log({ userId: user.id, action: 'PURCHASE_CANCEL', entity: 'purchase', entityId: id, ip, before: { status: p.status, purchaseNo: p.purchaseNo }, after: { status: 'CANCELLED', reason } }, tx);
    });
    return this.detail(id);
  }

  /** Return goods to the supplier against a posted purchase (FR-13). */
  async createReturn(id: number, input: z.infer<typeof PurchaseReturnInput>, user: SessionUser, ip: string) {
    const settings = await this.settings.get();
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM purchase WHERE id = ${id} FOR UPDATE`;
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
        data: { returnNo, purchaseId: id, supplierId: p.supplierId, userId: user.id, reason: input.reason, total: sum(lines.map((l) => l.amount)), items: { create: lines } },
        include: { items: true },
      });
      const warnings = await applyMovements(tx, moves.map((m) => ({ ...m, refId: ret.id })), user.id, { blockNegative: settings.blockNegativeStock });
      await this.audit.log({ userId: user.id, action: 'PURCHASE_RETURN', entity: 'purchase', entityId: id, ip, after: { returnNo, total: ret.total, lines } }, tx);
      return { ...ret, warnings };
    });
  }

  async detail(id: number) {
    const p = await this.prisma.purchase.findUnique({ where: { id }, include: fullInclude });
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
    const where: Prisma.PurchaseWhereInput = {
      AND: [
        q.from && q.to ? (() => { const r = istRange(q.from!, q.to!); return { OR: [{ postedAt: { gte: r.start, lt: r.end } }, { status: PurchaseStatus.DRAFT, createdAt: { gte: r.start, lt: r.end } }, { status: PurchaseStatus.CANCELLED, createdAt: { gte: r.start, lt: r.end } }] }; })() : {},
        q.supplierId ? { supplierId: q.supplierId } : {},
        q.status ? { status: q.status } : {},
        q.q ? { OR: [{ supplierInvoiceNo: { contains: q.q, mode: 'insensitive' } }, { purchaseNo: { contains: q.q, mode: 'insensitive' } }] } : {},
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.purchase.findMany({
        where,
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { supplier: { select: { name: true } }, createdBy: { select: { fullName: true } }, _count: { select: { items: true } } },
      }),
      this.prisma.purchase.count({ where }),
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
