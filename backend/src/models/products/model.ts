// Product master and the cached stock balance per product.
// Mongoose schemas for the existing MongoDB collections. Stored field names stay snake_case (the data is
// unchanged); each path has a camelCase alias, which is the name the services and the API use.
import { Model, model, models, Schema } from 'mongoose';
import type { Category, Unit } from '../masters/model';
import type { StockAdjustment, StockMovement } from '../stock/model';
import type { PurchaseItem } from '../purchases/model';
import type { SaleItem, SaleKitComponent } from '../sales/model';
import type { KitItem } from '../kits/model';

export interface Product {
  id: number;
  code: string;
  barcode: string | null;
  name: string;
  nameKey: string | null;
  categoryId: number;
  unitId: number;
  packUnitId: number | null;
  packSize: number;
  hsnCode: string | null;
  gstRate: number;
  mrp: number | null;
  salePrice: number;
  lastCost: number | null;
  reorderLevel: number;
  rackNo: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  category?: Category;
  unit?: Unit;
  packUnit?: Unit | null;
  stock?: ProductStock | null;
  movements?: StockMovement[];
  purchaseItems?: PurchaseItem[];
  saleItems?: SaleItem[];
  kitItems?: KitItem[];
  kitComponents?: SaleKitComponent[];
  adjustments?: StockAdjustment[];
}

export const ProductSchema = new Schema(
  {
    _id: { type: Schema.Types.Int32 },
    code: { type: String },
    barcode: { type: String, default: null },
    name: { type: String },
    name_key: { type: String, default: null, alias: 'nameKey' },
    category_id: { type: Schema.Types.Int32, alias: 'categoryId' },
    unit_id: { type: Schema.Types.Int32, alias: 'unitId' },
    pack_unit_id: { type: Schema.Types.Int32, default: null, alias: 'packUnitId' },
    pack_size: { type: Schema.Types.Double, default: 1, alias: 'packSize' },
    hsn_code: { type: String, default: null, alias: 'hsnCode' },
    gst_rate: { type: Schema.Types.Double, default: 0, alias: 'gstRate' },
    mrp: { type: Schema.Types.Double, default: null },
    sale_price: { type: Schema.Types.Double, alias: 'salePrice' },
    last_cost: { type: Schema.Types.Double, default: null, alias: 'lastCost' },
    reorder_level: { type: Schema.Types.Double, default: 0, alias: 'reorderLevel' },
    rack_no: { type: String, default: null, alias: 'rackNo' },
    is_active: { type: Boolean, default: true, alias: 'isActive' },
    created_at: { type: Date, default: Date.now, alias: 'createdAt' },
    updated_at: { type: Date, alias: 'updatedAt' },
  },
  { collection: 'product', versionKey: false, id: false, strict: 'throw', timestamps: { createdAt: false, updatedAt: 'updated_at' } },
);
ProductSchema.virtual('category', { ref: 'Category', localField: 'category_id', foreignField: '_id', justOne: true });
ProductSchema.virtual('unit', { ref: 'Unit', localField: 'unit_id', foreignField: '_id', justOne: true });
ProductSchema.virtual('packUnit', { ref: 'Unit', localField: 'pack_unit_id', foreignField: '_id', justOne: true });
ProductSchema.virtual('stock', { ref: 'ProductStock', localField: '_id', foreignField: '_id', justOne: true });
ProductSchema.virtual('movements', { ref: 'StockMovement', localField: '_id', foreignField: 'product_id', justOne: false });
ProductSchema.virtual('purchaseItems', { ref: 'PurchaseItem', localField: '_id', foreignField: 'product_id', justOne: false });
ProductSchema.virtual('saleItems', { ref: 'SaleItem', localField: '_id', foreignField: 'product_id', justOne: false });
ProductSchema.virtual('kitItems', { ref: 'KitItem', localField: '_id', foreignField: 'product_id', justOne: false });
ProductSchema.virtual('kitComponents', { ref: 'SaleKitComponent', localField: '_id', foreignField: 'product_id', justOne: false });
ProductSchema.virtual('adjustments', { ref: 'StockAdjustment', localField: '_id', foreignField: 'product_id', justOne: false });
ProductSchema.index({"code":1}, {"name":"product_code_key","unique":true});
ProductSchema.index({"category_id":1}, {"name":"product_category_id_idx"});
ProductSchema.index({"name_key":1}, {"name":"product_name_uq","unique":true,"partialFilterExpression":{"is_active":true,"name_key":{"$type":"string"}}});
ProductSchema.index({"barcode":1}, {"name":"product_barcode_key","unique":true,"partialFilterExpression":{"barcode":{"$type":"string"}}});
export const ProductModel = (models.Product as Model<Product>) ?? model<Product>('Product', ProductSchema);

export interface ProductStock {
  productId: number;
  onHand: number;
  product?: Product;
}

export const ProductStockSchema = new Schema(
  {
    _id: { type: Schema.Types.Int32, alias: 'productId' },
    on_hand: { type: Schema.Types.Double, default: 0, alias: 'onHand' },
  },
  { collection: 'product_stock', versionKey: false, id: false, strict: 'throw' },
);
ProductStockSchema.virtual('product', { ref: 'Product', localField: '_id', foreignField: '_id', justOne: true });
export const ProductStockModel = (models.ProductStock as Model<ProductStock>) ?? model<ProductStock>('ProductStock', ProductStockSchema);
