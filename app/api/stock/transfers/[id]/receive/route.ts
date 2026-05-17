import { NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { logActivity } from "@/lib/activity";
import { createInventoryCostLayer } from "@/lib/inventoryCosting";
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
        toLocation: { select: { branchId: true } },
        items: true,
      },
    });

    if (!transfer) {
      return { ok: false as const, message: "Transfer not found" };
    }
    if (transfer.status !== "IN_TRANSIT") {
      return { ok: false as const, message: "Only in-transit transfers can be received" };
    }
    if (!canCrossBranch(auth.user.permissions) && transfer.toBranchId !== auth.user.branchId) {
      return { ok: false as const, status: 403, message: "You can only receive transfers for your own branch" };
    }

    for (const item of transfer.items) {
      const receivedQty = item.shippedQty || item.quantity;
      const stockLevel = await tx.stockLevel.findFirst({
        where: {
          productId: item.productId,
          locationId: transfer.toLocationId,
        },
      });

      const previousQty = stockLevel?.quantity ?? 0;
      const newQty = previousQty + receivedQty;

      if (stockLevel) {
        await tx.stockLevel.update({
          where: { id: stockLevel.id },
          data: { quantity: newQty },
        });
      } else {
        await tx.stockLevel.create({
          data: {
            productId: item.productId,
            locationId: transfer.toLocationId,
            quantity: newQty,
          },
        });
      }

      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          locationId: transfer.toLocationId,
          type: "TRANSFER_IN",
          quantity: receivedQty,
          previousQty,
          newQty,
          reason: `Transfer ${transfer.transferNumber} received`,
          referenceId: transfer.id,
          userId: auth.user.id,
        },
      });

      await createInventoryCostLayer(tx, {
        productId: item.productId,
        locationId: transfer.toLocationId,
        branchId: transfer.toLocation.branchId,
        sourceType: "ADJUSTMENT",
        sourceId: transfer.id,
        quantity: receivedQty,
        unitCost: Number(item.unitCostSnapshot ?? 0),
        receivedAt: new Date(),
      });

      await tx.stockTransferItem.update({
        where: { id: item.id },
        data: { receivedQty },
      });
    }

    const updated = await tx.stockTransfer.update({
      where: { id },
      data: {
        status: "RECEIVED",
        receivedById: auth.user.id,
        receivedAt: new Date(),
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
    action: "STOCK_TRANSFER_RECEIVED",
    tableName: "StockTransfer",
    recordId: id,
    details: { transferNumber: result.transferNumber },
  });

  return NextResponse.json({ ok: true });
}
