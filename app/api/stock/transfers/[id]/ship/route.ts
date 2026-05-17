import { NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { logActivity } from "@/lib/activity";
import { consumeInventoryCost } from "@/lib/inventoryCosting";
import { PERMISSIONS, hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

function canCrossBranch(permissions: string[]) {
  return hasPermission(permissions, PERMISSIONS.inventoryCrossBranch) || hasPermission(permissions, PERMISSIONS.branchesReadAll);
}

export async function POST(_: Request, { params }: Params) {
  const auth = await requireApiAnyPermission([PERMISSIONS.stockTransfersManage]);
  if (!auth.ok) return auth.response;

  const { id } = await params;

  const result = await prisma.$transaction(async (tx) => {
    const transfer = await tx.stockTransfer.findUnique({
      where: { id },
      include: {
        items: true,
        fromLocation: { select: { branchId: true } },
      },
    });

    if (!transfer) {
      return { ok: false as const, message: "Transfer not found" };
    }
    if (transfer.status !== "DRAFT") {
      return { ok: false as const, message: "Only draft transfers can be shipped" };
    }
    if (!canCrossBranch(auth.user.permissions) && transfer.fromBranchId !== auth.user.branchId) {
      return { ok: false as const, status: 403, message: "You can only ship transfers from your own branch" };
    }

    for (const item of transfer.items) {
      const stockLevel = await tx.stockLevel.findFirst({
        where: {
          productId: item.productId,
          locationId: transfer.fromLocationId,
        },
      });
      if (!stockLevel || stockLevel.quantity < item.quantity) {
        return { ok: false as const, message: "Not enough stock to ship this transfer" };
      }

      const newQty = stockLevel.quantity - item.quantity;
      await tx.stockLevel.update({
        where: { id: stockLevel.id },
        data: { quantity: newQty },
      });

      const stockMovement = await tx.stockMovement.create({
        data: {
          productId: item.productId,
          locationId: transfer.fromLocationId,
          type: "TRANSFER_OUT",
          quantity: -item.quantity,
          previousQty: stockLevel.quantity,
          newQty,
          reason: `Transfer ${transfer.transferNumber} shipped`,
          referenceId: transfer.id,
          userId: auth.user.id,
        },
      });

      const costing = await consumeInventoryCost(tx, {
        productId: item.productId,
        locationId: transfer.fromLocationId,
        quantity: item.quantity,
        occurredAt: new Date(),
        reason: "ADJUSTMENT_LOSS",
        stockMovementId: stockMovement.id,
      });

      await tx.stockTransferItem.update({
        where: { id: item.id },
        data: {
          shippedQty: item.quantity,
          unitCostSnapshot: costing.unitCost,
          totalCostSnapshot: costing.totalCost,
        },
      });
    }

    const updated = await tx.stockTransfer.update({
      where: { id },
      data: {
        status: "IN_TRANSIT",
        shippedById: auth.user.id,
        shippedAt: new Date(),
      },
      select: { transferNumber: true },
    });

    return { ok: true as const, transferNumber: updated.transferNumber };
  });

  if (!result.ok) {
    return NextResponse.json({ message: result.message }, { status: "status" in result ? result.status : 400 });
  }

  await logActivity({
    userId: auth.user.id,
    action: "STOCK_TRANSFER_SHIPPED",
    tableName: "StockTransfer",
    recordId: id,
    details: { transferNumber: result.transferNumber },
  });

  return NextResponse.json({ ok: true });
}
