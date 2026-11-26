// Counter sales: bills, lines, kit components, payments, held bills, returns.
// Mongoose schemas for the existing MongoDB collections. Stored field names stay snake_case (the data is
// unchanged); each path has a camelCase alias, which is the name the services and the API use.
import { Model, model, models, Schema } from 'mongoose';
import type { Counter } from '../masters/model';
import type { AppUser } from '../auth/model';
import type { Product } from '../products/model';
import type { Kit } from '../kits/model';

export const SaleStatus = { COMPLETED: 'COMPLETED', CANCELLED: 'CANCELLED' } as const;
export type SaleStatus = (typeof SaleStatus)[keyof typeof SaleStatus];

export const PaymentMode = { CASH: 'CASH', UPI: 'UPI', CARD: 'CARD' } as const;
export type PaymentMode = (typeof PaymentMode)[keyof typeof PaymentMode];

export interface Sale {
  id: number;
  billNo: string;
  counterId: number;
  userId: number;
  billedAt: Date;
  itemsTotal: number;
  discountTotal: number;
  taxTotal: number;
  roundOff: number;
  grandTotal: number;
  tendered: number;
  changeDue: number;
  status: SaleStatus;
  idempotencyKey: string;
  customerName: string | null;
  remarks: string | null;
  printCount: number;
  priceOverride: boolean;
  editedAt: Date | null;
  editCount: number;
  cancelReason: string | null;
  cancelledById: number | null;
  cancelledAt: Date | null;
  rowVersion: number;
  counter?: Counter;
  user?: AppUser;
  cancelledBy?: AppUser | null;
  items?: SaleItem[];
  payments?: SalePayment[];
  returns?: SalesReturn[];
}

export const SaleSchema = new Schema(
  {
    _id: { type: Schema.Types.BigInt },
    bill_no: { type: String, alias: 'billNo' },
    counter_id: { type: Schema.Types.Int32, alias: 'counterId' },
    user_id: { type: Schema.Types.Int32, alias: 'userId' },
    billed_at: { type: Date, default: Date.now, alias: 'billedAt' },
    items_total: { type: Schema.Types.Double, alias: 'itemsTotal' },
    discount_total: { type: Schema.Types.Double, default: 0, alias: 'discountTotal' },
    tax_total: { type: Schema.Types.Double, default: 0, alias: 'taxTotal' },
    round_off: { type: Schema.Types.Double, default: 0, alias: 'roundOff' },
    grand_total: { type: Schema.Types.Double, alias: 'grandTotal' },
    tendered: { type: Schema.Types.Double, default: 0 },
    change_due: { type: Schema.Types.Double, default: 0, alias: 'changeDue' },
    status: { type: String, enum: Object.values(SaleStatus), default: 'COMPLETED' },
    idempotency_key: { type: String, alias: 'idempotencyKey' },
    customer_name: { type: String, default: null, alias: 'customerName' },
    remarks: { type: String, default: null },
    print_count: { type: Schema.Types.Int32, default: 0, alias: 'printCount' },
    price_override: { type: Boolean, default: false, alias: 'priceOverride' },
    edited_at: { type: Date, default: null, alias: 'editedAt' },
    edit_count: { type: Schema.Types.Int32, default: 0, alias: 'editCount' },
    cancel_reason: { type: String, default: null, alias: 'cancelReason' },
    cancelled_by: { type: Schema.Types.Int32, default: null, alias: 'cancelledById' },
    cancelled_at: { type: Date, default: null, alias: 'cancelledAt' },
    row_version: { type: Schema.Types.Int32, default: 0, alias: 'rowVersion' },
  },
  { collection: 'sale', versionKey: false, id: false, strict: 'throw' },
);
SaleSchema.virtual('counter', { ref: 'Counter', localField: 'counter_id', foreignField: '_id', justOne: true });
SaleSchema.virtual('user', { ref: 'AppUser', localField: 'user_id', foreignField: '_id', justOne: true });
SaleSchema.virtual('cancelledBy', { ref: 'AppUser', localField: 'cancelled_by', foreignField: '_id', justOne: true });
SaleSchema.virtual('items', { ref: 'SaleItem', localField: '_id', foreignField: 'sale_id', justOne: false });
SaleSchema.virtual('payments', { ref: 'SalePayment', localField: '_id', foreignField: 'sale_id', justOne: false });
SaleSchema.virtual('returns', { ref: 'SalesReturn', localField: '_id', foreignField: 'sale_id', justOne: false });
SaleSchema.index({"bill_no":1}, {"name":"sale_bill_no_key","unique":true});
SaleSchema.index({"idempotency_key":1}, {"name":"sale_idempotency_key_key","unique":true});
SaleSchema.index({"billed_at":1}, {"name":"sale_billed_at_idx"});
SaleSchema.index({"counter_id":1,"billed_at":1}, {"name":"sale_counter_id_billed_at_idx"});
SaleSchema.index({"user_id":1,"billed_at":1}, {"name":"sale_user_id_billed_at_idx"});
export const SaleModel = (models.Sale as Model<Sale>) ?? model<Sale>('Sale', SaleSchema);

export interface SaleItem {
  id: number;
  saleId: number;
  lineNo: number;
  productId: number | null;
  kitId: number | null;
  codeSnapshot: string;
  nameSnapshot: string;
  qty: number;
  rate: number;
  masterRate: number;
  discount: number;
  gstRate: number;
  taxAmount: number;
  lineTotal: number;
  costAtSale: number;
  sale?: Sale;
  product?: Product | null;
  kit?: Kit | null;
  components?: SaleKitComponent[];
  returnLines?: SalesReturnItem[];
}

export const SaleItemSchema = new Schema(
  {
    _id: { type: Schema.Types.Int32 },
    sale_id: { type: Schema.Types.BigInt, alias: 'saleId' },
    line_no: { type: Schema.Types.Int32, alias: 'lineNo' },
    product_id: { type: Schema.Types.Int32, default: null, alias: 'productId' },
    kit_id: { type: Schema.Types.Int32, default: null, alias: 'kitId' },
    code_snapshot: { type: String, alias: 'codeSnapshot' },
    name_snapshot: { type: String, alias: 'nameSnapshot' },
    qty: { type: Schema.Types.Double },
    rate: { type: Schema.Types.Double },
    master_rate: { type: Schema.Types.Double, default: 0, alias: 'masterRate' },
    discount: { type: Schema.Types.Double, default: 0 },
    gst_rate: { type: Schema.Types.Double, default: 0, alias: 'gstRate' },
    tax_amount: { type: Schema.Types.Double, default: 0, alias: 'taxAmount' },
    line_total: { type: Schema.Types.Double, alias: 'lineTotal' },
    cost_at_sale: { type: Schema.Types.Double, default: 0, alias: 'costAtSale' },
  },
  { collection: 'sale_item', versionKey: false, id: false, strict: 'throw' },
);
SaleItemSchema.virtual('sale', { ref: 'Sale', localField: 'sale_id', foreignField: '_id', justOne: true });
SaleItemSchema.virtual('product', { ref: 'Product', localField: 'product_id', foreignField: '_id', justOne: true });
SaleItemSchema.virtual('kit', { ref: 'Kit', localField: 'kit_id', foreignField: '_id', justOne: true });
SaleItemSchema.virtual('components', { ref: 'SaleKitComponent', localField: '_id', foreignField: 'sale_item_id', justOne: false });
SaleItemSchema.virtual('returnLines', { ref: 'SalesReturnItem', localField: '_id', foreignField: 'sale_item_id', justOne: false });
SaleItemSchema.index({"sale_id":1}, {"name":"sale_item_sale_id_idx"});
SaleItemSchema.index({"product_id":1}, {"name":"sale_item_product_id_idx"});
export const SaleItemModel = (models.SaleItem as Model<SaleItem>) ?? model<SaleItem>('SaleItem', SaleItemSchema);

export interface SaleKitComponent {
  id: number;
  saleItemId: number;
  productId: number;
  qtyPerKit: number;
  gstRate: number;
  unitCost: number;
  saleItem?: SaleItem;
  product?: Product;
}

export const SaleKitComponentSchema = new Schema(
  {
    _id: { type: Schema.Types.Int32 },
    sale_item_id: { type: Schema.Types.Int32, alias: 'saleItemId' },
    product_id: { type: Schema.Types.Int32, alias: 'productId' },
    qty_per_kit: { type: Schema.Types.Double, alias: 'qtyPerKit' },
    gst_rate: { type: Schema.Types.Double, default: 0, alias: 'gstRate' },
    unit_cost: { type: Schema.Types.Double, default: 0, alias: 'unitCost' },
  },
  { collection: 'sale_kit_component', versionKey: false, id: false, strict: 'throw' },
);
SaleKitComponentSchema.virtual('saleItem', { ref: 'SaleItem', localField: 'sale_item_id', foreignField: '_id', justOne: true });
SaleKitComponentSchema.virtual('product', { ref: 'Product', localField: 'product_id', foreignField: '_id', justOne: true });
SaleKitComponentSchema.index({"sale_item_id":1}, {"name":"sale_kit_component_sale_item_id_idx"});
export const SaleKitComponentModel = (models.SaleKitComponent as Model<SaleKitComponent>) ?? model<SaleKitComponent>('SaleKitComponent', SaleKitComponentSchema);

export interface SalePayment {
  id: number;
  saleId: number;
  mode: PaymentMode;
  amount: number;
  reference: string | null;
  sale?: Sale;
}

export const SalePaymentSchema = new Schema(
  {
    _id: { type: Schema.Types.Int32 },
    sale_id: { type: Schema.Types.BigInt, alias: 'saleId' },
    mode: { type: String, enum: Object.values(PaymentMode) },
    amount: { type: Schema.Types.Double },
    reference: { type: String, default: null },
  },
  { collection: 'sale_payment', versionKey: false, id: false, strict: 'throw' },
);
SalePaymentSchema.virtual('sale', { ref: 'Sale', localField: 'sale_id', foreignField: '_id', justOne: true });
SalePaymentSchema.index({"sale_id":1}, {"name":"sale_payment_sale_id_idx"});
SalePaymentSchema.index({"mode":1,"reference":1}, {"name":"sale_payment_mode_reference_idx"});
export const SalePaymentModel = (models.SalePayment as Model<SalePayment>) ?? model<SalePayment>('SalePayment', SalePaymentSchema);

export interface HeldBill {
  id: number;
  counterId: number;
  userId: number;
  label: string;
  payload: unknown;
  createdAt: Date;
  counter?: Counter;
  user?: AppUser;
}

export const HeldBillSchema = new Schema(
  {
    _id: { type: Schema.Types.Int32 },
    counter_id: { type: Schema.Types.Int32, alias: 'counterId' },
    user_id: { type: Schema.Types.Int32, alias: 'userId' },
    label: { type: String },
    payload: { type: Schema.Types.Mixed },
    created_at: { type: Date, default: Date.now, alias: 'createdAt' },
  },
  { collection: 'held_bill', versionKey: false, id: false, strict: 'throw' },
);
HeldBillSchema.virtual('counter', { ref: 'Counter', localField: 'counter_id', foreignField: '_id', justOne: true });
HeldBillSchema.virtual('user', { ref: 'AppUser', localField: 'user_id', foreignField: '_id', justOne: true });
HeldBillSchema.index({"counter_id":1}, {"name":"held_bill_counter_id_idx"});
export const HeldBillModel = (models.HeldBill as Model<HeldBill>) ?? model<HeldBill>('HeldBill', HeldBillSchema);

export interface SalesReturn {
  id: number;
  returnNo: string;
  saleId: number;
  userId: number;
  reason: string;
  refundMode: PaymentMode;
  total: number;
  createdAt: Date;
  sale?: Sale;
  user?: AppUser;
  items?: SalesReturnItem[];
}

export const SalesReturnSchema = new Schema(
  {
    _id: { type: Schema.Types.Int32 },
    return_no: { type: String, alias: 'returnNo' },
    sale_id: { type: Schema.Types.BigInt, alias: 'saleId' },
    user_id: { type: Schema.Types.Int32, alias: 'userId' },
    reason: { type: String },
    refund_mode: { type: String, enum: Object.values(PaymentMode), default: 'CASH', alias: 'refundMode' },
    total: { type: Schema.Types.Double },
    created_at: { type: Date, default: Date.now, alias: 'createdAt' },
  },
  { collection: 'sales_return', versionKey: false, id: false, strict: 'throw' },
);
SalesReturnSchema.virtual('sale', { ref: 'Sale', localField: 'sale_id', foreignField: '_id', justOne: true });
SalesReturnSchema.virtual('user', { ref: 'AppUser', localField: 'user_id', foreignField: '_id', justOne: true });
SalesReturnSchema.virtual('items', { ref: 'SalesReturnItem', localField: '_id', foreignField: 'return_id', justOne: false });
SalesReturnSchema.index({"return_no":1}, {"name":"sales_return_return_no_key","unique":true});
SalesReturnSchema.index({"created_at":1}, {"name":"sales_return_created_at_idx"});
export const SalesReturnModel = (models.SalesReturn as Model<SalesReturn>) ?? model<SalesReturn>('SalesReturn', SalesReturnSchema);

export interface SalesReturnItem {
  id: number;
  returnId: number;
  saleItemId: number;
  qty: number;
  amount: number;
  salesReturn?: SalesReturn;
  saleItem?: SaleItem;
}

export const SalesReturnItemSchema = new Schema(
  {
    _id: { type: Schema.Types.Int32 },
    return_id: { type: Schema.Types.Int32, alias: 'returnId' },
    sale_item_id: { type: Schema.Types.Int32, alias: 'saleItemId' },
    qty: { type: Schema.Types.Double },
    amount: { type: Schema.Types.Double },
  },
  { collection: 'sales_return_item', versionKey: false, id: false, strict: 'throw' },
);
SalesReturnItemSchema.virtual('salesReturn', { ref: 'SalesReturn', localField: 'return_id', foreignField: '_id', justOne: true });
SalesReturnItemSchema.virtual('saleItem', { ref: 'SaleItem', localField: 'sale_item_id', foreignField: '_id', justOne: true });
SalesReturnItemSchema.index({"sale_item_id":1}, {"name":"sales_return_item_sale_item_id_idx"});
export const SalesReturnItemModel = (models.SalesReturnItem as Model<SalesReturnItem>) ?? model<SalesReturnItem>('SalesReturnItem', SalesReturnItemSchema);
