import { z } from 'zod';
import { zMoney, zQty } from '../validate';

export const KitBody = z.object({
  code: z.string().trim().toUpperCase().min(1).max(20).regex(/^[A-Z0-9\-]+$/, 'use letters, digits and - only'),
  name: z.string().trim().min(2).max(120),
  price: zMoney,
  isActive: z.boolean().default(true),
  items: z
    .array(z.object({ productId: z.coerce.number().int().positive(), qty: zQty }))
    .min(1, 'A kit needs at least one item')
    .max(50),
});
