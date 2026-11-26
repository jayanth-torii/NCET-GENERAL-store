import { z } from 'zod';
import { istDate } from '../../utils/time';
import { zDate, zFormat } from '../validate';

const today = () => istDate();
const monthStart = () => `${istDate().slice(0, 8)}01`;

export const RangeQ = z.object({
  from: zDate.default(monthStart),
  to: zDate.default(today),
  format: zFormat,
  counterId: z.coerce.number().int().positive().optional(),
  userId: z.coerce.number().int().positive().optional(),
  supplierId: z.coerce.number().int().positive().optional(),
});

export const StockQ = z.object({
  from: zDate.default(monthStart),
  to: zDate.default(today),
  categoryId: z.coerce.number().int().positive().optional(),
  q: z.string().trim().max(60).optional(),
  belowReorderOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  format: zFormat,
});
