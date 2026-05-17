import Dexie, { type Table } from "dexie";

export interface LocalProduct {
  id: string;
  sku: string;
  barcode?: string;
  name: string;
  nameAr?: string;
  categoryId: string;
  categoryName: string;
  brandName?: string;
  sellPrice: number;
  costPrice: number;
  taxRate: number;
  hasSerials: boolean;
  salesRank: number;
  syncStatus: "synced" | "pending" | "conflict";
  updatedAt: string;
}

export interface LocalSale {
  id: string;
  invoiceNumber: string;
  customerId?: string;
  cashierId: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  total: number;
  status: string;
  createdAt: string;
  syncStatus: "synced" | "pending" | "failed";
  /** Shown on reprinted invoice; editable by admin in POS */
  notes?: string;
}

export interface LocalSaleItem {
  id: string;
  saleId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  total: number;
}

export interface LocalPayment {
  id: string;
  saleId: string;
  method: string;
  amount: number;
  reference?: string;
  createdAt: string;
  syncStatus: "synced" | "pending" | "failed";
}

export interface LocalCustomer {
  id: string;
  name: string;
  phone: string;
  email?: string;
  creditBalance: number;
  loyaltyPoints: number;
  type: string;
  syncStatus: "synced" | "pending";
  updatedAt: string;
}

export interface LocalStockLevel {
  id: string;
  productId: string;
  locationId: string;
  quantity: number;
  syncStatus: "synced" | "pending";
  updatedAt: string;
}

export interface LocalStockMovement {
  id: string;
  productId: string;
  locationId: string;
  type: string;
  quantity: number;
  previousQty: number;
  newQty: number;
  reason?: string;
  referenceId?: string;
  userId: string;
  createdAt: string;
  syncStatus: "synced" | "pending";
}

export interface LocalCashShift {
  id: string;
  branchId: string;
  userId: string;
  status: "OPEN" | "CLOSED";
  openedAt: string;
  openingCash: number;
  closedAt?: string;
  expectedCash: number;
  countedCash?: number;
  variance: number;
  notes?: string;
  syncStatus: "synced" | "pending" | "failed";
  updatedAt: string;
}

export interface LocalCashShiftEntry {
  id: string;
  shiftId: string;
  branchId: string;
  userId: string;
  type: "OPENING_FLOAT" | "SALE_CASH" | "REFUND_CASH" | "PAYIN" | "PAYOUT" | "CLOSE";
  amount: number;
  note?: string;
  saleId?: string;
  refundId?: string;
  createdAt: string;
  syncStatus: "synced" | "pending" | "failed";
  updatedAt: string;
}

export interface SyncQueueItem {
  id?: number;
  tableName: string;
  recordId: string;
  operation: "CREATE" | "UPDATE" | "DELETE";
  payload: object;
  status: "pending" | "syncing" | "synced" | "failed" | "conflict";
  attempts: number;
  createdAt: string;
  lastAttemptAt?: string;
  errorMessage?: string;
}

class HardwareStoreDB extends Dexie {
  products!: Table<LocalProduct>;
  sales!: Table<LocalSale>;
  sale_items!: Table<LocalSaleItem>;
  payments!: Table<LocalPayment>;
  customers!: Table<LocalCustomer>;
  stock_levels!: Table<LocalStockLevel>;
  stock_movements!: Table<LocalStockMovement>;
  cash_shifts!: Table<LocalCashShift>;
  cash_shift_entries!: Table<LocalCashShiftEntry>;
  sync_queue!: Table<SyncQueueItem>;

  constructor() {
    super("HardwareStoreDB");
    this.version(1).stores({
      products: "id, sku, barcode, categoryId, salesRank, syncStatus, updatedAt",
      sales: "id, customerId, cashierId, createdAt, syncStatus",
      sale_items: "id, saleId, productId",
      customers: "id, phone, syncStatus, updatedAt",
      stock_levels: "id, productId, locationId, syncStatus",
      sync_queue: "++id, tableName, recordId, status, createdAt",
    });

    this.version(2).stores({
      products: "id, sku, barcode, categoryId, salesRank, syncStatus, updatedAt",
      sales: "id, customerId, cashierId, createdAt, syncStatus",
      sale_items: "id, saleId, productId",
      payments: "id, saleId, method, createdAt, syncStatus",
      customers: "id, phone, syncStatus, updatedAt",
      stock_levels: "id, productId, locationId, syncStatus",
      sync_queue: "++id, tableName, recordId, status, createdAt",
    });

    this.version(3).stores({
      products: "id, sku, barcode, categoryId, salesRank, syncStatus, updatedAt",
      sales: "id, customerId, cashierId, createdAt, syncStatus",
      sale_items: "id, saleId, productId",
      payments: "id, saleId, method, createdAt, syncStatus",
      customers: "id, phone, syncStatus, updatedAt",
      stock_levels: "id, productId, locationId, syncStatus",
      stock_movements: "id, productId, locationId, type, createdAt, syncStatus",
      sync_queue: "++id, tableName, recordId, status, createdAt",
    });

    this.version(4).stores({
      products: "id, sku, barcode, categoryId, salesRank, syncStatus, updatedAt",
      sales: "id, customerId, cashierId, createdAt, syncStatus",
      sale_items: "id, saleId, productId",
      payments: "id, saleId, method, createdAt, syncStatus",
      customers: "id, phone, syncStatus, updatedAt",
      stock_levels: "id, productId, locationId, syncStatus",
      stock_movements: "id, productId, locationId, type, createdAt, syncStatus",
      cash_shifts: "id, branchId, userId, status, openedAt, syncStatus",
      cash_shift_entries: "id, shiftId, branchId, userId, type, createdAt, syncStatus",
      sync_queue: "++id, tableName, recordId, status, createdAt",
    });
  }
}

export const db = new HardwareStoreDB();
