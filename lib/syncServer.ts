import type { PrismaClient } from "@prisma/client";
import { applySaleStockMovementCosting } from "@/lib/inventoryCosting";
import { prisma } from "@/lib/prisma";
import { validateSyncPayload } from "@/lib/syncSchemas";

type Operation = "CREATE" | "UPDATE" | "DELETE";

type SyncRequest = {
  tableName: string;
  recordId: string;
  operation: Operation;
  payload: Record<string, unknown>;
};

type PrismaDelegate = {
  upsert: (args: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => Promise<unknown>;
  update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  delete: (args: { where: { id: string } }) => Promise<unknown>;
  findUnique: (args: { where: { id: string } }) => Promise<unknown>;
};

const modelMap: Record<string, string> = {
  sales: "sale",
  sale_items: "saleItem",
  payments: "payment",
  customers: "customer",
  stock_levels: "stockLevel",
  stock_movements: "stockMovement",
  cash_shifts: "cashShift",
  cash_shift_entries: "cashShiftEntry",
};

const supportedTables = new Set(Object.keys(modelMap));

function sanitizePayload(tableName: string, payload: Record<string, unknown>) {
  const withId = { ...payload };
  delete withId.syncStatus;
  delete withId.updatedAt;
  delete withId._previousQuantity;

  if (tableName === "sales") {
    delete withId.paymentMethod;
  }

  if (tableName === "cash_shift_entries") {
    delete withId.branchId;
  }

  return withId;
}

function modelDelegate(client: PrismaClient, tableName: string): PrismaDelegate | null {
  const model = modelMap[tableName];
  if (!model) return null;
  return (client as unknown as Record<string, PrismaDelegate>)[model] ?? null;
}

async function reconcileSyncedSaleCosting(saleId: string, productId?: string) {
  const movements = await prisma.stockMovement.findMany({
    where: {
      type: "SALE",
      referenceId: saleId,
      ...(productId ? { productId } : {}),
    },
    select: {
      id: true,
      productId: true,
      locationId: true,
      quantity: true,
      createdAt: true,
      referenceId: true,
    },
  });

  for (const movement of movements) {
    if (!movement.referenceId) continue;
    const saleId = movement.referenceId;
    await prisma.$transaction(async (tx) => {
      await applySaleStockMovementCosting(tx, {
        stockMovementId: movement.id,
        saleId,
        productId: movement.productId,
        locationId: movement.locationId,
        quantity: movement.quantity,
        createdAt: movement.createdAt,
      });
    });
  }
}

async function recalculateCashShift(shiftId: string) {
  const shift = await prisma.cashShift.findUnique({
    where: { id: shiftId },
    select: {
      openingCash: true,
      countedCash: true,
      entries: {
        select: {
          type: true,
          amount: true,
        },
      },
    },
  });
  if (!shift) return;

  const expectedCash = Number(shift.openingCash) + shift.entries.reduce((sum, entry) => {
    const amount = Number(entry.amount);
    if (entry.type === "SALE_CASH" || entry.type === "PAYIN") return sum + amount;
    if (entry.type === "REFUND_CASH" || entry.type === "PAYOUT") return sum - amount;
    return sum;
  }, 0);

  const variance = shift.countedCash == null ? 0 : Number(shift.countedCash) - expectedCash;
  await prisma.cashShift.update({
    where: { id: shiftId },
    data: {
      expectedCash,
      variance,
    },
  });
}

export async function processSyncMutation(syncItem: SyncRequest) {
  if (!supportedTables.has(syncItem.tableName)) {
    return { status: "error", message: `Unsupported table: ${syncItem.tableName}` } as const;
  }

  if (!syncItem.recordId || !syncItem.operation || !syncItem.payload || typeof syncItem.payload !== "object") {
    return { status: "error", message: "Invalid sync payload format" } as const;
  }

  const delegate = modelDelegate(prisma, syncItem.tableName);
  if (!delegate) {
    return { status: "error", message: `Unsupported table: ${syncItem.tableName}` } as const;
  }

  const sanitized = sanitizePayload(syncItem.tableName, syncItem.payload);
  const validationResult = validateSyncPayload(syncItem.tableName, sanitized);
  if (!validationResult.success) {
    return { status: "error", message: validationResult.message } as const;
  }
  const dataWithId = { ...sanitized, id: syncItem.recordId };

  try {
    if (syncItem.operation === "DELETE") {
      await delegate.delete({ where: { id: syncItem.recordId } });
      return { status: "synced" } as const;
    }

    if (syncItem.operation === "UPDATE") {
      await delegate.update({ where: { id: syncItem.recordId }, data: sanitized });
      return { status: "synced" } as const;
    }

    if (syncItem.tableName === "sales") {
      const existingSale = await delegate.findUnique({ where: { id: syncItem.recordId } });
      if (existingSale) {
        return {
          status: "conflict",
          serverRecord: existingSale,
          message: "Sales are immutable; conflicting create detected",
        } as const;
      }
    }

    await delegate.upsert({
      where: { id: syncItem.recordId },
      create: dataWithId,
      update: sanitized,
    });

    if (syncItem.tableName === "sale_items") {
      const saleId = typeof sanitized.saleId === "string" ? sanitized.saleId : null;
      const productId = typeof sanitized.productId === "string" ? sanitized.productId : undefined;
      if (saleId) {
        await reconcileSyncedSaleCosting(saleId, productId);
      }
    }

    if (syncItem.tableName === "stock_movements" && sanitized.type === "SALE" && typeof sanitized.referenceId === "string") {
      await reconcileSyncedSaleCosting(sanitized.referenceId, typeof sanitized.productId === "string" ? sanitized.productId : undefined);
    }

    if (syncItem.tableName === "cash_shift_entries" && typeof sanitized.shiftId === "string") {
      await recalculateCashShift(sanitized.shiftId);
    }

    if (syncItem.tableName === "cash_shifts") {
      await recalculateCashShift(syncItem.recordId);
    }

    return { status: "synced", serverId: syncItem.recordId } as const;
  } catch {
    const serverRecord = await delegate.findUnique({ where: { id: syncItem.recordId } });
    if (serverRecord) {
      return { status: "conflict", serverRecord } as const;
    }
    return { status: "error", message: "Sync mutation failed" } as const;
  }
}

export async function getSyncServerRecord(tableName: string, recordId: string) {
  const delegate = modelDelegate(prisma, tableName);
  if (!delegate) return null;
  return delegate.findUnique({ where: { id: recordId } });
}
