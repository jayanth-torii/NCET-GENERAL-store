import { PaymentMode, SaleStatus } from '../../models/sales/model';
import { z } from 'zod';
import { istDate } from '../../utils/time';
import { zDate, zMoney, zOptText, zQty, zReason } from '../validate';

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

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const SaleListQuery = z.object({
  from: zDate.default(() => istDate()),
  to: zDate.default(() => istDate()),
  counterId: z.coerce.number().int().positive().optional(),
  userId: z.coerce.number().int().positive().optional(),
  status: z.nativeEnum(SaleStatus).optional(),
  q: z.string().trim().max(40).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
});
