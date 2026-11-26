// Audit trail, store settings and dashboard alerts.
// Mongoose schemas for the existing MongoDB collections. Stored field names stay snake_case (the data is
// unchanged); each path has a camelCase alias, which is the name the services and the API use.
import { Model, model, models, Schema } from 'mongoose';
import type { AppUser } from '../auth/model';

export const GstMode = { NOT_REGISTERED: 'NOT_REGISTERED', REGISTERED: 'REGISTERED' } as const;
export type GstMode = (typeof GstMode)[keyof typeof GstMode];

export interface AuditLog {
  id: number;
  userId: number | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown | null;
  after: unknown | null;
  ip: string | null;
  createdAt: Date;
  user?: AppUser | null;
}

export const AuditLogSchema = new Schema(
  {
    _id: { type: Schema.Types.BigInt },
    user_id: { type: Schema.Types.Int32, default: null, alias: 'userId' },
    action: { type: String },
    entity: { type: String },
    entity_id: { type: String, default: null, alias: 'entityId' },
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
    ip: { type: String, default: null },
    created_at: { type: Date, default: Date.now, alias: 'createdAt' },
  },
  { collection: 'audit_log', versionKey: false, id: false, strict: 'throw' },
);
AuditLogSchema.virtual('user', { ref: 'AppUser', localField: 'user_id', foreignField: '_id', justOne: true });
AuditLogSchema.index({"created_at":1}, {"name":"audit_log_created_at_idx"});
AuditLogSchema.index({"entity":1,"entity_id":1}, {"name":"audit_log_entity_entity_id_idx"});
export const AuditLogModel = (models.AuditLog as Model<AuditLog>) ?? model<AuditLog>('AuditLog', AuditLogSchema);

export interface StoreSetting {
  id: number;
  storeName: string;
  addressLine: string;
  phone: string | null;
  gstin: string | null;
  gstMode: GstMode;
  receiptFooter: string;
  blockNegativeStock: boolean;
  roundBillToRupee: boolean;
  maxCashierDiscount: number;
  upiId: string | null;
  upiPayeeName: string | null;
  requireUpiReference: boolean;
  requireCardReference: boolean;
  autoLockMinutes: number;
  returnWindowDays: number;
  updatedAt: Date;
}

export const StoreSettingSchema = new Schema(
  {
    _id: { type: Schema.Types.Int32 },
    store_name: { type: String, default: 'GENERAL STORE', alias: 'storeName' },
    address_line: { type: String, default: 'Nagarjuna College of Engineering & Technology', alias: 'addressLine' },
    phone: { type: String, default: null },
    gstin: { type: String, default: null },
    gst_mode: { type: String, enum: Object.values(GstMode), default: 'NOT_REGISTERED', alias: 'gstMode' },
    receipt_footer: { type: String, default: 'Thank you! Goods once sold can be returned only with this bill.', alias: 'receiptFooter' },
    block_negative_stock: { type: Boolean, default: false, alias: 'blockNegativeStock' },
    round_bill_to_rupee: { type: Boolean, default: true, alias: 'roundBillToRupee' },
    max_cashier_discount_pct: { type: Schema.Types.Double, default: 0, alias: 'maxCashierDiscount' },
    upi_id: { type: String, default: null, alias: 'upiId' },
    upi_payee_name: { type: String, default: null, alias: 'upiPayeeName' },
    require_upi_reference: { type: Boolean, default: true, alias: 'requireUpiReference' },
    require_card_reference: { type: Boolean, default: false, alias: 'requireCardReference' },
    auto_lock_minutes: { type: Schema.Types.Int32, default: 10, alias: 'autoLockMinutes' },
    return_window_days: { type: Schema.Types.Int32, default: 30, alias: 'returnWindowDays' },
    updated_at: { type: Date, alias: 'updatedAt' },
  },
  { collection: 'store_setting', versionKey: false, id: false, strict: 'throw', timestamps: { createdAt: false, updatedAt: 'updated_at' } },
);
export const StoreSettingModel = (models.StoreSetting as Model<StoreSetting>) ?? model<StoreSetting>('StoreSetting', StoreSettingSchema);

export interface SystemAlert {
  id: number;
  kind: string;
  message: string;
  details: unknown | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

export const SystemAlertSchema = new Schema(
  {
    _id: { type: Schema.Types.Int32 },
    kind: { type: String },
    message: { type: String },
    details: { type: Schema.Types.Mixed, default: null },
    created_at: { type: Date, default: Date.now, alias: 'createdAt' },
    resolved_at: { type: Date, default: null, alias: 'resolvedAt' },
  },
  { collection: 'system_alert', versionKey: false, id: false, strict: 'throw' },
);
SystemAlertSchema.index({"resolved_at":1}, {"name":"system_alert_resolved_at_idx"});
export const SystemAlertModel = (models.SystemAlert as Model<SystemAlert>) ?? model<SystemAlert>('SystemAlert', SystemAlertSchema);
