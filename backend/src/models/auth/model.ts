// Users and login sessions.
// Mongoose schemas for the existing MongoDB collections. Stored field names stay snake_case (the data is
// unchanged); each path has a camelCase alias, which is the name the services and the API use.
import { randomUUID } from 'crypto';
import { Model, model, models, Schema } from 'mongoose';
import type { HeldBill, Sale, SalesReturn } from '../sales/model';
import type { Purchase, PurchaseReturn } from '../purchases/model';
import type { StockAdjustment, StockMovement } from '../stock/model';
import type { AuditLog } from '../admin/model';

export const Role = { ADMIN: 'ADMIN', MANAGER: 'MANAGER', STORE_KEEPER: 'STORE_KEEPER', CASHIER: 'CASHIER' } as const;
export type Role = (typeof Role)[keyof typeof Role];

export interface AppUser {
  id: number;
  username: string;
  fullName: string;
  role: Role;
  passwordHash: string;
  mustChangePassword: boolean;
  tokenVersion: number;
  lockedAt: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  sales?: Sale[];
  cancelledSales?: Sale[];
  heldBills?: HeldBill[];
  purchasesCreated?: Purchase[];
  purchasesPosted?: Purchase[];
  purchasesReadied?: Purchase[];
  movements?: StockMovement[];
  auditLogs?: AuditLog[];
  adjustmentsAsked?: StockAdjustment[];
  adjustmentsDecide?: StockAdjustment[];
  salesReturns?: SalesReturn[];
  purchaseReturns?: PurchaseReturn[];
  sessions?: Session[];
}

export const AppUserSchema = new Schema(
  {
    _id: { type: Schema.Types.Int32 },
    username: { type: String },
    full_name: { type: String, alias: 'fullName' },
    role: { type: String, enum: Object.values(Role) },
    password_hash: { type: String, alias: 'passwordHash' },
    must_change_password: { type: Boolean, default: true, alias: 'mustChangePassword' },
    token_version: { type: Schema.Types.Int32, default: 0, alias: 'tokenVersion' },
    locked_at: { type: Date, default: null, alias: 'lockedAt' },
    is_active: { type: Boolean, default: true, alias: 'isActive' },
    created_at: { type: Date, default: Date.now, alias: 'createdAt' },
    updated_at: { type: Date, alias: 'updatedAt' },
  },
  { collection: 'app_user', versionKey: false, id: false, strict: 'throw', timestamps: { createdAt: false, updatedAt: 'updated_at' } },
);
AppUserSchema.virtual('sales', { ref: 'Sale', localField: '_id', foreignField: 'user_id', justOne: false });
AppUserSchema.virtual('cancelledSales', { ref: 'Sale', localField: '_id', foreignField: 'cancelled_by', justOne: false });
AppUserSchema.virtual('heldBills', { ref: 'HeldBill', localField: '_id', foreignField: 'user_id', justOne: false });
AppUserSchema.virtual('purchasesCreated', { ref: 'Purchase', localField: '_id', foreignField: 'created_by', justOne: false });
AppUserSchema.virtual('purchasesPosted', { ref: 'Purchase', localField: '_id', foreignField: 'posted_by', justOne: false });
AppUserSchema.virtual('purchasesReadied', { ref: 'Purchase', localField: '_id', foreignField: 'ready_by', justOne: false });
AppUserSchema.virtual('movements', { ref: 'StockMovement', localField: '_id', foreignField: 'created_by', justOne: false });
AppUserSchema.virtual('auditLogs', { ref: 'AuditLog', localField: '_id', foreignField: 'user_id', justOne: false });
AppUserSchema.virtual('adjustmentsAsked', { ref: 'StockAdjustment', localField: '_id', foreignField: 'requested_by', justOne: false });
AppUserSchema.virtual('adjustmentsDecide', { ref: 'StockAdjustment', localField: '_id', foreignField: 'decided_by', justOne: false });
AppUserSchema.virtual('salesReturns', { ref: 'SalesReturn', localField: '_id', foreignField: 'user_id', justOne: false });
AppUserSchema.virtual('purchaseReturns', { ref: 'PurchaseReturn', localField: '_id', foreignField: 'user_id', justOne: false });
AppUserSchema.virtual('sessions', { ref: 'Session', localField: '_id', foreignField: 'user_id', justOne: false });
AppUserSchema.index({"username":1}, {"name":"app_user_username_key","unique":true});
export const AppUserModel = (models.AppUser as Model<AppUser>) ?? model<AppUser>('AppUser', AppUserSchema);

export interface Session {
  id: string;
  userId: number;
  counterId: number | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedBy: string | null;
  user?: AppUser;
}

export const SessionSchema = new Schema(
  {
    _id: { type: String, default: () => randomUUID() },
    user_id: { type: Schema.Types.Int32, alias: 'userId' },
    counter_id: { type: Schema.Types.Int32, default: null, alias: 'counterId' },
    ip: { type: String, default: null },
    user_agent: { type: String, default: null, alias: 'userAgent' },
    created_at: { type: Date, default: Date.now, alias: 'createdAt' },
    last_seen_at: { type: Date, default: Date.now, alias: 'lastSeenAt' },
    expires_at: { type: Date, alias: 'expiresAt' },
    revoked_at: { type: Date, default: null, alias: 'revokedAt' },
    revoked_by: { type: String, default: null, alias: 'revokedBy' },
  },
  { collection: 'session', versionKey: false, id: false, strict: 'throw' },
);
SessionSchema.virtual('user', { ref: 'AppUser', localField: 'user_id', foreignField: '_id', justOne: true });
SessionSchema.index({"user_id":1,"revoked_at":1}, {"name":"session_user_id_revoked_at_idx"});
export const SessionModel = (models.Session as Model<Session>) ?? model<Session>('Session', SessionSchema);
