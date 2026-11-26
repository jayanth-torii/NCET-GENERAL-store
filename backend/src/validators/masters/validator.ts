import { ChargeAllocation } from '@prisma/client';
import { z } from 'zod';
import { zOptText } from '../validate';

export const NameBody = z.object({ name: z.string().trim().min(2).max(60) });

export const UnitBody = z.object({
  code: z.string().trim().toUpperCase().min(1).max(8).regex(/^[A-Z0-9]+$/, 'use letters and digits only'),
  name: z.string().trim().min(2).max(40),
  allowDecimal: z.boolean().default(false),
});

export const SupplierBody = z.object({
  name: z.string().trim().min(2).max(120),
  phone: zOptText(20),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^$|^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'GSTIN must be 15 characters like 29ABCDE1234F1Z5')
    .optional()
    .nullable()
    .transform((v) => v || null),
  address: zOptText(300),
  isActive: z.boolean().default(true),
});

export const ChargeTypeBody = z.object({
  name: z.string().trim().min(2).max(40),
  addsToCost: z.boolean().default(true),
  allocation: z.nativeEnum(ChargeAllocation).default(ChargeAllocation.BY_VALUE),
  isActive: z.boolean().default(true),
});

export const CounterBody = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{0,5}$/, 'code must start with a letter, e.g. C1'),
  name: z.string().trim().min(2).max(40),
  printerName: zOptText(80),
  isActive: z.boolean().default(true),
});
