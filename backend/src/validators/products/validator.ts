import { z } from 'zod';
import { zGst, zMoney, zOptText, zQty, zRate4 } from '../validate';

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

export const ProductListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  active: z.enum(['true', 'false', 'all']).default('true'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});
