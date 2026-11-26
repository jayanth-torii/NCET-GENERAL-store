import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

/** Parse a request body or query with a zod schema; reply 400 with readable messages on failure. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const messages = r.error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message));
    throw new BadRequestException({ message: messages.join('; '), errors: messages });
  }
  return r.data;
}

/** Common field schemas. */
export const zMoney = z.coerce
  .number({ error: 'must be a number' })
  .finite()
  .min(0, 'cannot be negative')
  .max(99_99_99_999, 'is too large')
  .refine((v) => Math.round(v * 100) === Number((v * 100).toFixed(6)), 'can have at most 2 decimals');

export const zQty = z.coerce
  .number({ error: 'must be a number' })
  .finite()
  .positive('must be more than zero')
  .max(9_999_999, 'is too large')
  .refine((v) => Math.round(v * 1000) === Number((v * 1000).toFixed(6)), 'can have at most 3 decimals');

export const zRate4 = z.coerce
  .number()
  .finite()
  .min(0, 'cannot be negative')
  .max(99_99_99_999)
  .refine((v) => Math.round(v * 10000) === Number((v * 10000).toFixed(6)), 'can have at most 4 decimals');

export const zGst = z.coerce.number().finite().min(0).max(40);
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date like 2026-10-12');
export const zId = z.coerce.number().int().positive();
export const zText = (max = 200) => z.string().trim().max(max);
export const zOptText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));
export const zReason = z.string().trim().min(3, 'Give a reason of at least 3 characters').max(300);
export const zFormat = z.enum(['json', 'pdf', 'xlsx']).default('json');
