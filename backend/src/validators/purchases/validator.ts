import { EntryUnit, PurchaseStatus } from '@prisma/client';
import { z } from 'zod';
import { zDate, zGst, zMoney, zOptText, zQty, zRate4, zReason } from '../validate';
import { istDate } from '../../utils/time';

/** Invoice dates cannot be in the future (server clock, IST). */
const notFuture = (d: string) => d <= istDate();

export const PurchaseHeader = z.object({
  supplierId: z.coerce.number().int().positive('Choose a supplier'),
  supplierInvoiceNo: z.string().trim().min(1, 'Enter the supplier invoice / DC number').max(40),
  invoiceDate: zDate.refine(notFuture, 'Invoice date cannot be in the future'),
  taxInclusive: z.boolean().default(true),
  notes: zOptText(300),
  invoiceTotal: zMoney.optional().nullable(), // invoice amount printed on the supplier bill
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
    salePrice: zMoney.optional().nullable(), // new selling price; blank keeps the current one
    mrp: zMoney.optional().nullable(),
  })
  .refine((l) => (l.rate !== null && l.rate !== undefined) !== (l.amount !== null && l.amount !== undefined), {
    message: 'Enter either the rate or the line amount',
    path: ['rate'],
  })
  .refine((l) => l.salePrice === null || l.salePrice === undefined || l.salePrice > 0, { message: 'Sale price must be more than zero', path: ['salePrice'] })
  .refine((l) => l.mrp === null || l.mrp === undefined || l.mrp > 0, { message: 'MRP must be more than zero', path: ['mrp'] });

export const PurchaseReturnInput = z.object({
  items: z.array(z.object({ purchaseItemId: z.coerce.number().int().positive(), baseQty: zQty })).min(1).max(300),
  reason: zReason,
});

export const PurchaseListQuery = z.object({
  from: zDate.optional(),
  to: zDate.optional(),
  supplierId: z.coerce.number().int().positive().optional(),
  status: z.nativeEnum(PurchaseStatus).optional(),
  q: z.string().trim().max(40).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
});
