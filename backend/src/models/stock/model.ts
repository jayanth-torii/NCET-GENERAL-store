// Append-only stock ledger and manager-approved stock adjustments.
// Mongoose schemas for the existing MongoDB collections. Stored field names stay snake_case (the data is
// unchanged); each path has a camelCase alias, which is the name the services and the API use.
import { Model, model, models, Schema } from 'mongoose';
import type { Product } from '../products/model';
import type { AppUser } from '../auth/model';

export const MovementKind = { OPENING: 'OPENING', PURCHASE: 'PURCHASE', SALE: 'SALE', SALE_RETURN: 'SALE_RETURN', PURCHASE_RETURN: 'PURCHASE_RETURN', ADJUSTMENT: 'ADJUSTMENT', CANCEL: 'CANCEL' } as const;
export type MovementKind = (typeof MovementKind)[keyof typeof MovementKind];

export const AdjustmentStatus = { PENDING: 'PENDING', APPROVED: 'APPROVED', REJECTED: 'REJECTED' } as const;
export type AdjustmentStatus = (typeof AdjustmentStatus)[keyof typeof AdjustmentStatus];

export interface StockMovement {
  id: number;
  productId: number;
  kind: MovementKind;
  qty: number;
  unitCost: number | null;
  refType: string;
  refId: number;
  note: string | null;
  createdById: number | null;
  createdAt: Date;
  product?: Product;
  createdBy?: AppUser | null;
}

export const StockMovementSchema = new Schema(
  {
    _id: { type: Schema.Types.BigInt },
    product_id: { type: Schema.Types.Int32, alias: 'productId' },
    kind: { type: String, enum: Object.values(MovementKind) },
    qty: { type: Schema.Types.Double },
    unit_cost: { type: Schema.Types.Double, default: null, alias: 'unitCost' },
    ref_type: { type: String, alias: 'refType' },
    ref_id: { type: Schema.Types.BigInt, alias: 'refId' },
    note: { type: String, default: null },
    created_by: { type: Schema.Types.Int32, default: null, alias: 'createdById' },
    created_at: { type: Date, default: Date.now, alias: 'createdAt' },
  },
  { collection: 'stock_movement', versionKey: false, id: false, strict: 'throw' },
);
StockMovementSchema.virtual('product', { ref: 'Product', localField: 'product_id', foreignField: '_id', justOne: true });
StockMovementSchema.virtual('createdBy', { ref: 'AppUser', localField: 'created_by', foreignField: '_id', justOne: true });
StockMovementSchema.index({"product_id":1,"created_at":1}, {"name":"stock_movement_product_id_created_at_idx"});
StockMovementSchema.index({"created_at":1}, {"name":"stock_movement_created_at_idx"});
StockMovementSchema.index({"ref_type":1,"ref_id":1}, {"name":"stock_movement_ref_type_ref_id_idx"});
export const StockMovementModel = (models.StockMovement as Model<StockMovement>) ?? model<StockMovement>('StockMovement', StockMovementSchema);

export interface StockAdjustment {
  id: number;
  productId: number;
  qtyChange: number;
  reason: string;
  status: AdjustmentStatus;
  requestedById: number;
  decidedById: number | null;
  decisionNote: string | null;
  createdAt: Date;
  decidedAt: Date | null;
  product?: Product;
  requestedBy?: AppUser;
  decidedBy?: AppUser | null;
}

export const StockAdjustmentSchema = new Schema(
  {
    _id: { type: Schema.Types.Int32 },
    product_id: { type: Schema.Types.Int32, alias: 'productId' },
    qty_change: { type: Schema.Types.Double, alias: 'qtyChange' },
    reason: { type: String },
    status: { type: String, enum: Object.values(AdjustmentStatus), default: 'PENDING' },
    requested_by: { type: Schema.Types.Int32, alias: 'requestedById' },
    decided_by: { type: Schema.Types.Int32, default: null, alias: 'decidedById' },
    decision_note: { type: String, default: null, alias: 'decisionNote' },
    created_at: { type: Date, default: Date.now, alias: 'createdAt' },
    decided_at: { type: Date, default: null, alias: 'decidedAt' },
  },
  { collection: 'stock_adjustment', versionKey: false, id: false, strict: 'throw' },
);
StockAdjustmentSchema.virtual('product', { ref: 'Product', localField: 'product_id', foreignField: '_id', justOne: true });
StockAdjustmentSchema.virtual('requestedBy', { ref: 'AppUser', localField: 'requested_by', foreignField: '_id', justOne: true });
StockAdjustmentSchema.virtual('decidedBy', { ref: 'AppUser', localField: 'decided_by', foreignField: '_id', justOne: true });
StockAdjustmentSchema.index({"status":1}, {"name":"stock_adjustment_status_idx"});
export const StockAdjustmentModel = (models.StockAdjustment as Model<StockAdjustment>) ?? model<StockAdjustment>('StockAdjustment', StockAdjustmentSchema);
