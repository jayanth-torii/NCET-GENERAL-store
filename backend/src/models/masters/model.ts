// Masters: counters, categories, units, suppliers, purchase charge types.
// Mongoose schemas for the existing MongoDB collections. Stored field names stay snake_case (the data is
// unchanged); each path has a camelCase alias, which is the name the services and the API use.
import { Model, model, models, Schema } from 'mongoose';
import type { HeldBill, Sale } from '../sales/model';
import type { Product } from '../products/model';
import type { Purchase, PurchaseCharge, PurchaseReturn } from '../purchases/model';

export const ChargeAllocation = { BY_VALUE: 'BY_VALUE', BY_QTY: 'BY_QTY', NONE: 'NONE' } as const;
export type ChargeAllocation = (typeof ChargeAllocation)[keyof typeof ChargeAllocation];

export interface Counter {
  id: number;
  code: string;
  name: string;
  printerName: string | null;
  isActive: boolean;
  createdAt: Date;
  sales?: Sale[];
  heldBills?: HeldBill[];
}

export const CounterSchema = new Schema(
  {
    _id: { type: Schema.Types.Int32 },
    code: { type: String },
    name: { type: String },
    printer_name: { type: String, default: null, alias: 'printerName' },
    is_active: { type: Boolean, default: true, alias: 'isActive' },
    created_at: { type: Date, default: Date.now, alias: 'createdAt' },
  },
  { collection: 'counter', versionKey: false, id: false, strict: 'throw' },
);
CounterSchema.virtual('sales', { ref: 'Sale', localField: '_id', foreignField: 'counter_id', justOne: false });
CounterSchema.virtual('heldBills', { ref: 'HeldBill', localField: '_id', foreignField: 'counter_id', justOne: false });
CounterSchema.index({"code":1}, {"name":"counter_code_key","unique":true});
export const CounterModel = (models.Counter as Model<Counter>) ?? model<Counter>('Counter', CounterSchema);

export interface Category {
  id: number;
  name: string;
  products?: Product[];
}

export const CategorySchema = new Schema(
  {
    _id: { type: Schema.Types.Int32 },
    name: { type: String },
  },
  { collection: 'category', versionKey: false, id: false, strict: 'throw' },
);
CategorySchema.virtual('products', { ref: 'Product', localField: '_id', foreignField: 'category_id', justOne: false });
CategorySchema.index({"name":1}, {"name":"category_name_key","unique":true});
export const CategoryModel = (models.Category as Model<Category>) ?? model<Category>('Category', CategorySchema);

export interface Unit {
  id: number;
  code: string;
  name: string;
  allowDecimal: boolean;
  products?: Product[];
  packProducts?: Product[];
}

export const UnitSchema = new Schema(
  {
    _id: { type: Schema.Types.Int32 },
    code: { type: String },
    name: { type: String },
    allow_decimal: { type: Boolean, default: false, alias: 'allowDecimal' },
  },
  { collection: 'unit', versionKey: false, id: false, strict: 'throw' },
);
UnitSchema.virtual('products', { ref: 'Product', localField: '_id', foreignField: 'unit_id', justOne: false });
UnitSchema.virtual('packProducts', { ref: 'Product', localField: '_id', foreignField: 'pack_unit_id', justOne: false });
UnitSchema.index({"code":1}, {"name":"unit_code_key","unique":true});
export const UnitModel = (models.Unit as Model<Unit>) ?? model<Unit>('Unit', UnitSchema);

export interface Supplier {
  id: number;
  name: string;
  phone: string | null;
  gstin: string | null;
  address: string | null;
  isActive: boolean;
  createdAt: Date;
  purchases?: Purchase[];
  returns?: PurchaseReturn[];
}

export const SupplierSchema = new Schema(
  {
    _id: { type: Schema.Types.Int32 },
    name: { type: String },
    phone: { type: String, default: null },
    gstin: { type: String, default: null },
    address: { type: String, default: null },
    is_active: { type: Boolean, default: true, alias: 'isActive' },
    created_at: { type: Date, default: Date.now, alias: 'createdAt' },
  },
  { collection: 'supplier', versionKey: false, id: false, strict: 'throw' },
);
SupplierSchema.virtual('purchases', { ref: 'Purchase', localField: '_id', foreignField: 'supplier_id', justOne: false });
SupplierSchema.virtual('returns', { ref: 'PurchaseReturn', localField: '_id', foreignField: 'supplier_id', justOne: false });
SupplierSchema.index({"name":1}, {"name":"supplier_name_key","unique":true});
export const SupplierModel = (models.Supplier as Model<Supplier>) ?? model<Supplier>('Supplier', SupplierSchema);

export interface ChargeType {
  id: number;
  name: string;
  addsToCost: boolean;
  allocation: ChargeAllocation;
  isActive: boolean;
  charges?: PurchaseCharge[];
}

export const ChargeTypeSchema = new Schema(
  {
    _id: { type: Schema.Types.Int32 },
    name: { type: String },
    adds_to_cost: { type: Boolean, default: true, alias: 'addsToCost' },
    allocation: { type: String, enum: Object.values(ChargeAllocation), default: 'BY_VALUE' },
    is_active: { type: Boolean, default: true, alias: 'isActive' },
  },
  { collection: 'charge_type', versionKey: false, id: false, strict: 'throw' },
);
ChargeTypeSchema.virtual('charges', { ref: 'PurchaseCharge', localField: '_id', foreignField: 'charge_type_id', justOne: false });
ChargeTypeSchema.index({"name":1}, {"name":"charge_type_name_key","unique":true});
export const ChargeTypeModel = (models.ChargeType as Model<ChargeType>) ?? model<ChargeType>('ChargeType', ChargeTypeSchema);
