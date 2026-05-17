import { Prisma, type MovementType } from "@prisma/client";
import { prisma } from "./prisma";

type TxClient = Prisma.TransactionClient;

export type CostLayerSnapshot = {
  id: string;
  remainingQty: number;
  unitCost: number;
  receivedAt: Date | string;
};

type PlannedAllocation = {
  layerId: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
};

type ConsumeInput = {
  productId: string;
  locationId: string;
  quantity: number;
  occurredAt?: Date;
  reason: "SALE" | "ADJUSTMENT_LOSS";
  saleItemId?: string;
  stockMovementId?: string;
  fallbackUnitCost?: number;
};

type LayerCreateInput = {
  productId: string;
  locationId: string;
  branchId?: string | null;
  poItemId?: string | null;
  sourceType: "PURCHASE" | "OPENING_STOCK" | "ADJUSTMENT" | "RETURN";
  sourceId?: string | null;
  quantity: number;
  unitCost: number;
  receivedAt?: Date;
};

type RestockInput = {
  refundItemId: string;
  saleItemId: string;
  quantity: number;
  stockMovementId?: string;
};

type SaleMovementInput = {
  stockMovementId: string;
  saleId: string;
  productId: string;
  locationId: string;
  quantity: number;
  createdAt: Date;
};

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

function decimal(value: number) {
  return new Prisma.Decimal(roundMoney(value));
}

function normalizeDate(value: Date | string) {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

export function planCostConsumption(layers: CostLayerSnapshot[], requestedQty: number): PlannedAllocation[] {
  let remaining = requestedQty;
  const plan: PlannedAllocation[] = [];
  const ordered = [...layers].sort((a, b) => normalizeDate(a.receivedAt) - normalizeDate(b.receivedAt));

  for (const layer of ordered) {
    if (remaining <= 0) break;
    if (layer.remainingQty <= 0) continue;
    const quantity = Math.min(layer.remainingQty, remaining);
    remaining -= quantity;
    plan.push({
      layerId: layer.id,
      quantity,
      unitCost: layer.unitCost,
      totalCost: roundMoney(quantity * layer.unitCost),
    });
  }

  return plan;
}

async function getFallbackCost(tx: TxClient, productId: string, override?: number) {
  if (typeof override === "number" && Number.isFinite(override) && override >= 0) {
    return roundMoney(override);
  }
  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { costPrice: true },
  });
  return roundMoney(Number(product?.costPrice ?? 0));
}

async function getLocationBranchId(tx: TxClient, locationId: string) {
  const location = await tx.location.findUnique({
    where: { id: locationId },
    select: { branchId: true },
  });
  return location?.branchId ?? null;
}

export async function createInventoryCostLayer(tx: TxClient, input: LayerCreateInput) {
  return tx.inventoryCostLayer.create({
    data: {
      productId: input.productId,
      locationId: input.locationId,
      branchId: input.branchId ?? null,
      poItemId: input.poItemId ?? null,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      unitCost: decimal(input.unitCost),
      originalQty: input.quantity,
      remainingQty: input.quantity,
      receivedAt: input.receivedAt ?? new Date(),
    },
  });
}

async function ensureLayerCoverage(
  tx: TxClient,
  input: Pick<ConsumeInput, "productId" | "locationId" | "quantity" | "occurredAt" | "fallbackUnitCost">,
) {
  const layers = await tx.inventoryCostLayer.findMany({
    where: {
      productId: input.productId,
      locationId: input.locationId,
      remainingQty: { gt: 0 },
    },
    orderBy: [{ receivedAt: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      remainingQty: true,
      unitCost: true,
      receivedAt: true,
    },
  });

  const availableQty = layers.reduce((sum, layer) => sum + layer.remainingQty, 0);
  if (availableQty >= input.quantity) {
    return layers.map((layer) => ({
      id: layer.id,
      remainingQty: layer.remainingQty,
      unitCost: Number(layer.unitCost),
      receivedAt: layer.receivedAt,
    }));
  }

  const missingQty = input.quantity - availableQty;
  const fallbackCost = await getFallbackCost(tx, input.productId, input.fallbackUnitCost);
  const branchId = await getLocationBranchId(tx, input.locationId);
  const syntheticLayer = await createInventoryCostLayer(tx, {
    productId: input.productId,
    locationId: input.locationId,
    branchId,
    sourceType: "OPENING_STOCK",
    sourceId: `synthetic:${input.productId}:${input.locationId}:${(input.occurredAt ?? new Date()).toISOString()}`,
    quantity: missingQty,
    unitCost: fallbackCost,
    receivedAt: input.occurredAt ?? new Date(),
  });

  return [
    ...layers.map((layer) => ({
      id: layer.id,
      remainingQty: layer.remainingQty,
      unitCost: Number(layer.unitCost),
      receivedAt: layer.receivedAt,
    })),
    {
      id: syntheticLayer.id,
      remainingQty: syntheticLayer.remainingQty,
      unitCost: Number(syntheticLayer.unitCost),
      receivedAt: syntheticLayer.receivedAt,
    },
  ];
}

async function updateSaleItemRealizedCost(
  tx: TxClient,
  saleItemId: string,
  allocatedQtyDelta: number,
  costDelta: number,
  occurredAt: Date,
) {
  const saleItem = await tx.saleItem.findUnique({
    where: { id: saleItemId },
    select: {
      quantity: true,
      total: true,
      costAllocatedQty: true,
      realizedCogs: true,
    },
  });
  if (!saleItem) return;

  const nextAllocatedQty = saleItem.costAllocatedQty + allocatedQtyDelta;
  const nextCogs = roundMoney(Number(saleItem.realizedCogs ?? 0) + costDelta);
  const realizedUnitCost = nextAllocatedQty > 0 ? roundMoney(nextCogs / nextAllocatedQty) : null;
  const grossProfit = roundMoney(Number(saleItem.total) - nextCogs);

  await tx.saleItem.update({
    where: { id: saleItemId },
    data: {
      costAllocatedQty: nextAllocatedQty,
      realizedCogs: decimal(nextCogs),
      realizedUnitCost: realizedUnitCost === null ? null : decimal(realizedUnitCost),
      grossProfit: decimal(grossProfit),
      costAllocatedAt: nextAllocatedQty >= saleItem.quantity ? occurredAt : undefined,
    },
  });
}

export async function consumeInventoryCost(tx: TxClient, input: ConsumeInput) {
  const requestedQty = Math.max(0, Math.trunc(input.quantity));
  if (requestedQty <= 0) {
    return { quantity: 0, totalCost: 0, unitCost: 0 };
  }

  const occurredAt = input.occurredAt ?? new Date();
  const coveredLayers = await ensureLayerCoverage(tx, input);
  const plan = planCostConsumption(coveredLayers, requestedQty);
  const totalCost = roundMoney(plan.reduce((sum, allocation) => sum + allocation.totalCost, 0));

  for (const allocation of plan) {
    await tx.inventoryCostLayer.update({
      where: { id: allocation.layerId },
      data: {
        remainingQty: {
          decrement: allocation.quantity,
        },
      },
    });

    await tx.inventoryCostAllocation.create({
      data: {
        layerId: allocation.layerId,
        saleItemId: input.saleItemId ?? null,
        stockMovementId: input.stockMovementId ?? null,
        direction: "OUT",
        reason: input.reason,
        quantity: allocation.quantity,
        unitCost: decimal(allocation.unitCost),
        totalCost: decimal(allocation.totalCost),
      },
    });
  }

  if (input.saleItemId) {
    await updateSaleItemRealizedCost(tx, input.saleItemId, requestedQty, totalCost, occurredAt);
  }

  return {
    quantity: requestedQty,
    totalCost,
    unitCost: requestedQty > 0 ? roundMoney(totalCost / requestedQty) : 0,
  };
}

export async function restockSaleItemCost(tx: TxClient, input: RestockInput) {
  const saleItem = await tx.saleItem.findUnique({
    where: { id: input.saleItemId },
    select: {
      refundedQty: true,
      costAllocations: {
        where: { direction: "OUT" },
        select: {
          layerId: true,
          quantity: true,
          unitCost: true,
        },
      },
      refundItems: {
        select: {
          id: true,
          costAllocations: {
            where: { direction: "IN" },
            select: {
              layerId: true,
              quantity: true,
            },
          },
        },
      },
    },
  });

  if (!saleItem) {
    throw new Error("Sale item not found for refund restock");
  }

  const refundedByLayer = new Map<string, number>();
  for (const refundItem of saleItem.refundItems) {
    for (const allocation of refundItem.costAllocations) {
      refundedByLayer.set(allocation.layerId, (refundedByLayer.get(allocation.layerId) ?? 0) + allocation.quantity);
    }
  }

  let remainingQty = input.quantity;
  let restockedCost = 0;

  for (const allocation of saleItem.costAllocations) {
    if (remainingQty <= 0) break;
    const alreadyRefunded = refundedByLayer.get(allocation.layerId) ?? 0;
    const refundableQty = Math.max(0, allocation.quantity - alreadyRefunded);
    if (refundableQty <= 0) continue;
    const quantity = Math.min(refundableQty, remainingQty);
    remainingQty -= quantity;
    const unitCost = Number(allocation.unitCost);
    const totalCost = roundMoney(quantity * unitCost);
    restockedCost += totalCost;

    await tx.inventoryCostLayer.update({
      where: { id: allocation.layerId },
      data: {
        remainingQty: {
          increment: quantity,
        },
      },
    });

    await tx.inventoryCostAllocation.create({
      data: {
        layerId: allocation.layerId,
        refundItemId: input.refundItemId,
        stockMovementId: input.stockMovementId ?? null,
        direction: "IN",
        reason: "REFUND_RESTOCK",
        quantity,
        unitCost: decimal(unitCost),
        totalCost: decimal(totalCost),
      },
    });
  }

  if (remainingQty > 0) {
    throw new Error("Not enough original sale cost remains to restock this refund");
  }

  await tx.saleItem.update({
    where: { id: input.saleItemId },
    data: {
      refundedQty: {
        increment: input.quantity,
      },
    },
  });

  await tx.refundItem.update({
    where: { id: input.refundItemId },
    data: {
      restockedQty: input.quantity,
      restockedCost: decimal(restockedCost),
    },
  });

  return {
    quantity: input.quantity,
    totalCost: roundMoney(restockedCost),
  };
}

export async function applySaleStockMovementCosting(tx: TxClient, input: SaleMovementInput) {
  let remainingQty = Math.max(0, Math.trunc(Math.abs(input.quantity)));
  if (remainingQty <= 0) return;

  const saleItems = await tx.saleItem.findMany({
    where: {
      saleId: input.saleId,
      productId: input.productId,
    },
    orderBy: { id: "asc" },
    select: {
      id: true,
      quantity: true,
      costAllocatedQty: true,
    },
  });

  for (const saleItem of saleItems) {
    if (remainingQty <= 0) break;
    const pendingQty = Math.max(0, saleItem.quantity - saleItem.costAllocatedQty);
    if (pendingQty <= 0) continue;
    const allocateQty = Math.min(pendingQty, remainingQty);
    remainingQty -= allocateQty;
    await consumeInventoryCost(tx, {
      productId: input.productId,
      locationId: input.locationId,
      quantity: allocateQty,
      occurredAt: input.createdAt,
      reason: "SALE",
      saleItemId: saleItem.id,
      stockMovementId: input.stockMovementId,
    });
  }
}

export async function backfillInventoryCosting() {
  await prisma.$transaction(async (tx) => {
    await tx.inventoryCostAllocation.deleteMany();
    await tx.inventoryCostLayer.deleteMany();
    await tx.refundItem.updateMany({
      data: {
        restockedQty: 0,
        restockedCost: decimal(0),
      },
    });
    await tx.saleItem.updateMany({
      data: {
        costAllocatedQty: 0,
        refundedQty: 0,
        realizedUnitCost: null,
        realizedCogs: null,
        grossProfit: null,
        costAllocatedAt: null,
      },
    });

    const movements = await tx.stockMovement.findMany({
      include: {
        product: {
          select: {
            costPrice: true,
          },
        },
        location: {
          select: {
            branchId: true,
          },
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    for (const movement of movements) {
      const quantity = Math.trunc(movement.quantity);
      if (quantity === 0) continue;

      if (movement.type === "PURCHASE" && quantity > 0) {
        const poItem = movement.referenceId
          ? await tx.pOItem.findFirst({
              where: {
                poId: movement.referenceId,
                productId: movement.productId,
              },
              select: {
                id: true,
                unitCost: true,
              },
            }).catch(() => null)
          : null;
        await createInventoryCostLayer(tx, {
          productId: movement.productId,
          locationId: movement.locationId,
          branchId: movement.location.branchId,
          poItemId: poItem?.id ?? null,
          sourceType: "PURCHASE",
          sourceId: movement.referenceId,
          quantity,
          unitCost: Number(poItem?.unitCost ?? movement.product.costPrice),
          receivedAt: movement.createdAt,
        });
        continue;
      }

      if (movement.type === "ADJUSTMENT" && quantity > 0) {
        await createInventoryCostLayer(tx, {
          productId: movement.productId,
          locationId: movement.locationId,
          branchId: movement.location.branchId,
          sourceType: "ADJUSTMENT",
          sourceId: movement.id,
          quantity,
          unitCost: Number(movement.product.costPrice),
          receivedAt: movement.createdAt,
        });
        continue;
      }

      if (movement.type === "RETURN" && quantity > 0) {
        await createInventoryCostLayer(tx, {
          productId: movement.productId,
          locationId: movement.locationId,
          branchId: movement.location.branchId,
          sourceType: "RETURN",
          sourceId: movement.referenceId ?? movement.id,
          quantity,
          unitCost: Number(movement.product.costPrice),
          receivedAt: movement.createdAt,
        });
        continue;
      }

      if (quantity < 0 && movement.type === "SALE" && movement.referenceId) {
        await applySaleStockMovementCosting(tx, {
          stockMovementId: movement.id,
          saleId: movement.referenceId,
          productId: movement.productId,
          locationId: movement.locationId,
          quantity,
          createdAt: movement.createdAt,
        });
        continue;
      }

      if (quantity < 0 && (movement.type === "ADJUSTMENT" || movement.type === "TRANSFER_OUT" || movement.type === "REPAIR_USE")) {
        await consumeInventoryCost(tx, {
          productId: movement.productId,
          locationId: movement.locationId,
          quantity: Math.abs(quantity),
          occurredAt: movement.createdAt,
          reason: "ADJUSTMENT_LOSS",
          stockMovementId: movement.id,
          fallbackUnitCost: Number(movement.product.costPrice),
        });
      }
    }
  });
}

export function isInventoryOutflow(type: MovementType, quantity: number) {
  return quantity < 0 && (type === "SALE" || type === "ADJUSTMENT" || type === "TRANSFER_OUT" || type === "REPAIR_USE");
}
