// Purchases (GRN): header, lines, charges, and returns to suppliers.
// Mongoose schemas for the existing MongoDB collections. Stored field names stay snake_case (the data is
// unchanged); each path has a camelCase alias, which is the name the services and the API use.
import { Model, model, models, Schema } from 'mongoose';
import type { AppUser } from '../auth/model';
import type { ChargeType, Supplier } from '../masters/model';
import type { Product } from '../products/model';

export const PurchaseStatus = { DRAFT: 'DRAFT', POSTED: 'POSTED', CANCELLED: 'CANCELLED' } as const;
export type PurchaseStatus = (typeof PurchaseStatus)[keyof typeof PurchaseStatus];

export const EntryUnit = { PACK: 'PACK', BASE: 'BASE' } as const;
export type EntryUnit = (typeof EntryUnit)[keyof typeof EntryUnit];

export interface Purchase {
  id: number;
  purchaseNo: string | null;
  supplierId: number;
  supplierInvoiceNo: string;
  invoiceKey: string | null;
  invoiceDate: Date;
  taxInclusive: boolean;
  itemsTotal: number;
  taxTotal: number;
  chargesTotal: number;
  discountTotal: number;
  roundOff: number;
  grandTotal: number;
  invoiceTotal: number | null;
  status: PurchaseStatus;
  notes: string | null;
  readyAt: Date | null;
  readyById: number | null;
  createdById: number;
  postedById: number | null;
  postedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  readyBy?: AppUser | null;
  supplier?: Supplier;
  createdBy?: AppUser;
  postedBy?: AppUser | null;
  items?: PurchaseItem[];
  charges?: PurchaseCharge[];
  returns?: PurchaseReturn[];
}

export const PurchaseSchema = new Schema(
  {
    _id: { type: Schema.Types.Int32 },
    purchase_no: { type: String, default: null, alias: 'purchaseNo' },
    supplier_id: { type: Schema.Types.Int32, alias: 'supplierId' },
    supplier_invoice_no: { type: String, alias: 'supplierInvoiceNo' },
    invoice_key: { type: String, default: null, alias: 'invoiceKey' },
    invoice_date: { type: Date, alias: 'invoiceDate' },
    tax_inclusive: { type: Boolean, default: false, alias: 'taxInclusive' },
    items_total: { type: Schema.Types.Double, default: 0, alias: 'itemsTotal' },
    tax_total: { type: Schema.Types.Double, default: 0, alias: 'taxTotal' },
    charges_total: { type: Schema.Types.Double, default: 0, alias: 'chargesTotal' },
    discount_total: { type: Schema.Types.Double, default: 0, alias: 'discountTotal' },
    round_off: { type: Schema.Types.Double, default: 0, alias: 'roundOff' },
    grand_total: { type: Schema.Types.Double, default: 0, alias: 'grandTotal' },
    invoice_total: { type: Schema.Types.Double, default: null, alias: 'invoiceTotal' },
    status: { type: String, enum: Object.values(PurchaseStatus), default: 'DRAFT' },
    notes: { type: String, default: null },
    ready_at: { type: Date, default: null, alias: 'readyAt' },
    ready_by: { type: Schema.Types.Int32, default: null, alias: 'readyById' },
    created_by: { type: Schema.Types.Int32, alias: 'createdById' },
    posted_by: { type: Schema.Types.Int32, default: null, alias: 'postedById' },
    posted_at: { type: Date, default: null, alias: 'postedAt' },
    cancelled_at: { type: Date, default: null, alias: 'cancelledAt' },
    cancel_reason: { type: String, default: null, alias: 'cancelReason' },
    created_at: { type: Date, default: Date.now, alias: 'createdAt' },
    updated_at: { type: Date, alias: 'updatedAt' },
  },
  { collection: 'purchase', versionKey: false, id: false, strict: 'throw', timestamps: { createdAt: false, updatedAt: 'updated_at' } },
);
PurchaseSchema.virtual('readyBy', { ref: 'AppUser', localField: 'ready_by', foreignField: '_id', justOne: true });
PurchaseSchema.virtual('supplier', { ref: 'Supplier', localField: 'supplier_id', foreignField: '_id', justOne: true });
PurchaseSchema.virtual('createdBy', { ref: 'AppUser', localField: 'created_by', foreignField: '_id', justOne: true });
PurchaseSchema.virtual('postedBy', { ref: 'AppUser', localField: 'posted_by', foreignField: '_id', justOne: true });
PurchaseSchema.virtual('items', { ref: 'PurchaseItem', localField: '_id', foreignField: 'purchase_id', justOne: false });
PurchaseSchema.virtual('charges', { ref: 'PurchaseCharge', localField: '_id', foreignField: 'purchase_id', justOne: false });
PurchaseSchema.virtual('returns', { ref: 'PurchaseReturn', localField: '_id', foreignField: 'purchase_id', justOne: false });
PurchaseSchema.index({"supplier_id":1}, {"name":"purchase_supplier_id_idx"});
PurchaseSchema.index({"status":1,"posted_at":1}, {"name":"purchase_status_posted_at_idx"});
PurchaseSchema.index({"supplier_id":1,"invoice_key":1}, {"name":"purchase_supplier_invoice_uq","unique":true,"partialFilterExpression":{"status":{"$in":["DRAFT","POSTED"]},"invoice_key":{"$type":"string"}}});
PurchaseSchema.index({"purchase_no":1}, {"name":"purchase_purchase_no_key","unique":true,"partialFilterExpression":{"purchase_no":{"$type":"string"}}});
export const PurchaseModel = (models.Purchase as Model<Purchase>) ?? model<Purchase>('Purchase', PurchaseSchema);

export interface PurchaseItem {
  id: number;
  purchaseId: number;
  productId: number;
  lineNo: number;
  entryUnit: EntryUnit;
  enteredQty: number;
  packSize: number;
  baseQty: number;
  rate: number;
  grossAmount: number;
  discount: number;
  gstRate: number;
  taxAmount: number;
  lineTotal: number;
  landedUnitCost: number | null;
  batch: string | null;
  expiry: Date | null;
  salePrice: number | null;
  mrp: number | null;
  purchase?: Purchase;
  product?: Product;
  returnLines?: PurchaseReturnItem[];
}

export const PurchaseItemSchema = new Schema(
  {
    _id: { type: Schema.Types.Int32 },
    purchase_id: { type: Schema.Types.Int32, alias: 'purchaseId' },
    product_id: { type: Schema.Types.Int32, alias: 'productId' },
    line_no: { type: Schema.Types.Int32, alias: 'lineNo' },
    entry_unit: { type: String, enum: Object.values(EntryUnit), default: 'BASE', alias: 'entryUnit' },
    entered_qty: { type: Schema.Types.Double, alias: 'enteredQty' },
    pack_size: { type: Schema.Types.Double, alias: 'packSize' },
    base_qty: { type: Schema.Types.Double, alias: 'baseQty' },
    rate: { type: Schema.Types.Double },
    gross_amount: { type: Schema.Types.Double, alias: 'grossAmount' },
    discount: { type: Schema.Types.Double, default: 0 },
    gst_rate: { type: Schema.Types.Double, default: 0, alias: 'gstRate' },
    tax_amount: { type: Schema.Types.Double, default: 0, alias: 'taxAmount' },
    line_total: { type: Schema.Types.Double, alias: 'lineTotal' },
    landed_unit_cost: { type: Schema.Types.Double, default: null, alias: 'landedUnitCost' },
    batch: { type: String, default: null },
    expiry: { type: Date, default: null },
    sale_price: { type: Schema.Types.Double, default: null, alias: 'salePrice' },
    mrp: { type: Schema.Types.Double, default: null },
  },
  { collection: 'purchase_item', versionKey: false, id: false, strict: 'throw' },
);
PurchaseItemSchema.virtual('purchase', { ref: 'Purchase', localField: 'purchase_id', foreignField: '_id', justOne: true });
PurchaseItemSchema.virtual('product', { ref: 'Product', localField: 'product_id', foreignField: '_id', justOne: true });
PurchaseItemSchema.virtual('returnLines', { ref: 'PurchaseReturnItem', localField: '_id', foreignField: 'purchase_item_id', justOne: false });
PurchaseItemSchema.index({"purchase_id":1}, {"name":"purchase_item_purchase_id_idx"});
PurchaseItemSchema.index({"product_id":1}, {"name":"purchase_item_product_id_idx"});
export const PurchaseItemModel = (models.PurchaseItem as Model<PurchaseItem>) ?? model<PurchaseItem>('PurchaseItem', PurchaseItemSchema);

export interface PurchaseCharge {
  id: number;
  purchaseId: number;
  chargeTypeId: number;
  amount: number;
  paidTo: string | null;
  referenceNo: string | null;
  purchase?: Purchase;
  chargeType?: ChargeType;
}

export const PurchaseChargeSchema = new Schema(
  {
    _id: { type: Schema.Types.Int32 },
    purchase_id: { type: Schema.Types.Int32, alias: 'purchaseId' },
    charge_type_id: { type: Schema.Types.Int32, alias: 'chargeTypeId' },
    amount: { type: Schema.Types.Double },
    paid_to: { type: String, default: null, alias: 'paidTo' },
    reference_no: { type: String, default: null, alias: 'referenceNo' },
  },
  { collection: 'purchase_charge', versionKey: false, id: false, strict: 'throw' },
);
PurchaseChargeSchema.virtual('purchase', { ref: 'Purchase', localField: 'purchase_id', foreignField: '_id', justOne: true });
PurchaseChargeSchema.virtual('chargeType', { ref: 'ChargeType', localField: 'charge_type_id', foreignField: '_id', justOne: true });
PurchaseChargeSchema.index({"purchase_id":1}, {"name":"purchase_charge_purchase_id_idx"});
export const PurchaseChargeModel = (models.PurchaseCharge as Model<PurchaseCharge>) ?? model<PurchaseCharge>('PurchaseCharge', PurchaseChargeSchema);

export interface PurchaseReturn {
  id: number;
  returnNo: string;
  purchaseId: number;
  supplierId: number;
  userId: number;
  reason: string;
  total: number;
  createdAt: Date;
  purchase?: Purchase;
  supplier?: Supplier;
  user?: AppUser;
  items?: PurchaseReturnItem[];
}

export const PurchaseReturnSchema = new Schema(
  {
    _id: { type: Schema.Types.Int32 },
    return_no: { type: String, alias: 'returnNo' },
    purchase_id: { type: Schema.Types.Int32, alias: 'purchaseId' },
    supplier_id: { type: Schema.Types.Int32, alias: 'supplierId' },
    user_id: { type: Schema.Types.Int32, alias: 'userId' },
    reason: { type: String },
    total: { type: Schema.Types.Double },
    created_at: { type: Date, default: Date.now, alias: 'createdAt' },
  },
  { collection: 'purchase_return', versionKey: false, id: false, strict: 'throw' },
);
PurchaseReturnSchema.virtual('purchase', { ref: 'Purchase', localField: 'purchase_id', foreignField: '_id', justOne: true });
PurchaseReturnSchema.virtual('supplier', { ref: 'Supplier', localField: 'supplier_id', foreignField: '_id', justOne: true });
PurchaseReturnSchema.virtual('user', { ref: 'AppUser', localField: 'user_id', foreignField: '_id', justOne: true });
PurchaseReturnSchema.virtual('items', { ref: 'PurchaseReturnItem', localField: '_id', foreignField: 'return_id', justOne: false });
PurchaseReturnSchema.index({"return_no":1}, {"name":"purchase_return_return_no_key","unique":true});
PurchaseReturnSchema.index({"created_at":1}, {"name":"purchase_return_created_at_idx"});
export const PurchaseReturnModel = (models.PurchaseReturn as Model<PurchaseReturn>) ?? model<PurchaseReturn>('PurchaseReturn', PurchaseReturnSchema);

export interface PurchaseReturnItem {
  id: number;
  returnId: number;
  purchaseItemId: number;
  baseQty: number;
  amount: number;
  purchaseReturn?: PurchaseReturn;
  purchaseItem?: PurchaseItem;
}

export const PurchaseReturnItemSchema = new Schema(
  {
    _id: { type: Schema.Types.Int32 },
    return_id: { type: Schema.Types.Int32, alias: 'returnId' },
    purchase_item_id: { type: Schema.Types.Int32, alias: 'purchaseItemId' },
    base_qty: { type: Schema.Types.Double, alias: 'baseQty' },
    amount: { type: Schema.Types.Double },
  },
  { collection: 'purchase_return_item', versionKey: false, id: false, strict: 'throw' },
);
PurchaseReturnItemSchema.virtual('purchaseReturn', { ref: 'PurchaseReturn', localField: 'return_id', foreignField: '_id', justOne: true });
PurchaseReturnItemSchema.virtual('purchaseItem', { ref: 'PurchaseItem', localField: 'purchase_item_id', foreignField: '_id', justOne: true });
PurchaseReturnItemSchema.index({"purchase_item_id":1}, {"name":"purchase_return_item_purchase_item_id_idx"});
export const PurchaseReturnItemModel = (models.PurchaseReturnItem as Model<PurchaseReturnItem>) ?? model<PurchaseReturnItem>('PurchaseReturnItem', PurchaseReturnItemSchema);
