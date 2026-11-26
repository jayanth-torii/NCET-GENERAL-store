// Section kits (bundles of products sold together).
// Mongoose schemas for the existing MongoDB collections. Stored field names stay snake_case (the data is
// unchanged); each path has a camelCase alias, which is the name the services and the API use.
import { Model, model, models, Schema } from 'mongoose';
import type { SaleItem } from '../sales/model';
import type { Product } from '../products/model';

export interface Kit {
  id: number;
  code: string;
  name: string;
  price: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  items?: KitItem[];
  saleItems?: SaleItem[];
}

export const KitSchema = new Schema(
  {
    _id: { type: Schema.Types.Int32 },
    code: { type: String },
    name: { type: String },
    price: { type: Schema.Types.Double },
    is_active: { type: Boolean, default: true, alias: 'isActive' },
    created_at: { type: Date, default: Date.now, alias: 'createdAt' },
    updated_at: { type: Date, alias: 'updatedAt' },
  },
  { collection: 'kit', versionKey: false, id: false, strict: 'throw', timestamps: { createdAt: false, updatedAt: 'updated_at' } },
);
KitSchema.virtual('items', { ref: 'KitItem', localField: '_id', foreignField: 'kit_id', justOne: false });
KitSchema.virtual('saleItems', { ref: 'SaleItem', localField: '_id', foreignField: 'kit_id', justOne: false });
KitSchema.index({"code":1}, {"name":"kit_code_key","unique":true});
export const KitModel = (models.Kit as Model<Kit>) ?? model<Kit>('Kit', KitSchema);

export interface KitItem {
  id: number;
  kitId: number;
  productId: number;
  qty: number;
  kit?: Kit;
  product?: Product;
}

export const KitItemSchema = new Schema(
  {
    _id: { type: Schema.Types.Int32 },
    kit_id: { type: Schema.Types.Int32, alias: 'kitId' },
    product_id: { type: Schema.Types.Int32, alias: 'productId' },
    qty: { type: Schema.Types.Double },
  },
  { collection: 'kit_item', versionKey: false, id: false, strict: 'throw' },
);
KitItemSchema.virtual('kit', { ref: 'Kit', localField: 'kit_id', foreignField: '_id', justOne: true });
KitItemSchema.virtual('product', { ref: 'Product', localField: 'product_id', foreignField: '_id', justOne: true });
KitItemSchema.index({"kit_id":1,"product_id":1}, {"name":"kit_item_kit_id_product_id_key","unique":true});
export const KitItemModel = (models.KitItem as Model<KitItem>) ?? model<KitItem>('KitItem', KitItemSchema);
