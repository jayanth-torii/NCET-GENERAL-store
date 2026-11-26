import { GstMode } from '../../models/admin/model';
import { Role } from '../../models/auth/model';
import { z } from 'zod';
import { zOptText } from '../validate';

export const UserCreate = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9._]{2,29}$/, 'username: 3-30 letters, digits, dot or underscore, starting with a letter'),
  fullName: z.string().trim().min(2).max(60),
  role: z.nativeEnum(Role),
  password: z.string().min(1).max(128),
});

export const UserUpdate = z.object({
  fullName: z.string().trim().min(2).max(60),
  role: z.nativeEnum(Role),
  isActive: z.boolean(),
});

export const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export const SettingsBody = z
  .object({
    storeName: z.string().trim().min(2).max(60),
    addressLine: z.string().trim().min(2).max(200),
    phone: zOptText(30),
    gstin: z.string().trim().toUpperCase().optional().nullable().transform((v) => v || null),
    gstMode: z.nativeEnum(GstMode),
    receiptFooter: z.string().trim().max(200),
    blockNegativeStock: z.boolean(),
    roundBillToRupee: z.boolean(),
    maxCashierDiscount: z.coerce.number().min(0).max(100),
    upiId: z
      .string()
      .trim()
      .regex(/^$|^[A-Za-z0-9.\-_]{2,64}@[A-Za-z]{2,32}$/, 'UPI ID must look like storename@bank')
      .optional()
      .nullable()
      .transform((v) => v || null),
    upiPayeeName: zOptText(60),
    requireUpiReference: z.boolean().default(true),
    requireCardReference: z.boolean().default(false),
    autoLockMinutes: z.coerce.number().int().min(0).max(240).default(10),
    returnWindowDays: z.coerce.number().int().min(0).max(365).default(30),
  })
  .refine((s) => s.gstMode !== 'REGISTERED' || (s.gstin && GSTIN.test(s.gstin)), { message: 'A valid 15-character GSTIN is needed when the store is GST-registered', path: ['gstin'] })
  .refine((s) => !s.upiId || (s.upiPayeeName && s.upiPayeeName.length >= 2), { message: 'Enter the payee name shown in the customer\'s UPI app', path: ['upiPayeeName'] });
