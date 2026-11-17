export type Role = 'ADMIN' | 'MANAGER' | 'STORE_KEEPER' | 'CASHIER';

export interface Me {
  id: number;
  username: string;
  fullName: string;
  role: Role;
  counterId: number | null;
  counterCode: string | null;
  mustChangePassword: boolean;
  locked: boolean;
  sessionId: string;
}

export interface CatalogueItem {
  id: number;
  code: string;
  barcode: string | null;
  name: string;
  salePrice: number;
  mrp: number | null;
  gstRate: number;
  isActive: boolean;
  categoryId: number;
  unit: string;
  allowDecimal: boolean;
  onHand: number;
  packSize: number;
  packUnit: string | null;
  lastCost: number | null;
}

export interface Kit {
  id: number;
  code: string;
  name: string;
  price: number;
  isActive: boolean;
  items: { id: number; productId: number; qty: number; product: { id: number; code: string; name: string; salePrice: number; isActive: boolean } }[];
}

export interface Product {
  id: number;
  code: string;
  barcode: string | null;
  name: string;
  categoryId: number;
  categoryName: string;
  unitId: number;
  unitCode: string;
  allowDecimal: boolean;
  packUnitId: number | null;
  packUnitCode: string | null;
  packSize: number;
  hsnCode: string | null;
  gstRate: number;
  mrp: number | null;
  salePrice: number;
  lastCost: number | null;
  reorderLevel: number;
  rackNo: string | null;
  isActive: boolean;
  onHand: number;
}

export interface Category {
  id: number;
  name: string;
}
export interface Unit {
  id: number;
  code: string;
  name: string;
  allowDecimal: boolean;
}
export interface Counter {
  id: number;
  code: string;
  name: string;
  printerName?: string | null;
  isActive?: boolean;
}
export interface Supplier {
  id: number;
  name: string;
  phone: string | null;
  gstin: string | null;
  address: string | null;
  isActive: boolean;
}
export interface ChargeType {
  id: number;
  name: string;
  addsToCost: boolean;
  allocation: 'BY_VALUE' | 'BY_QTY' | 'NONE';
  isActive: boolean;
}

export interface Settings {
  storeName: string;
  addressLine: string;
  phone: string | null;
  gstin: string | null;
  gstMode: 'NOT_REGISTERED' | 'REGISTERED';
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
}

export type ColType = 'text' | 'money' | 'qty' | 'int' | 'date' | 'datetime' | 'pct';
export interface Report {
  title: string;
  subtitle?: string;
  fileName: string;
  generatedAt: string;
  generatedBy?: string;
  summary?: { label: string; value: string | number; type?: ColType }[];
  sections: { title?: string; columns: { key: string; label: string; type?: ColType }[]; rows: Record<string, unknown>[]; totals?: Record<string, unknown>; note?: string }[];
}

export interface StockWarning {
  productId: number;
  code: string;
  name: string;
  onHand: number;
}
