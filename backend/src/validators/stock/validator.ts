import { z } from 'zod';
import { zReason } from '../validate';

export const AdjustBody = z
  .object({
    productId: z.coerce.number().int().positive(),
    qtyChange: z.coerce.number().finite().min(-9_999_999).max(9_999_999).optional(),
    countedQty: z.coerce.number().finite().min(0).max(9_999_999).optional(),
    reason: zReason,
  })
  .refine((b) => (b.qtyChange === undefined) !== (b.countedQty === undefined), 'Give either the change or the counted quantity');
