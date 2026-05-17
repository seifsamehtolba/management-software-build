import { NextRequest, NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { createInventoryCostLayer } from "@/lib/inventoryCosting";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireApiAnyPermission([PERMISSIONS.purchaseOrdersReceive]);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = (await req.json()) as {
    locationId: string;
    userId?: string;
  };

  if (!body.locationId?.trim()) {
    return NextResponse.json({ message: "locationId is required" }, { status: 400 });
  }

  const location = await prisma.location.findUnique({
    where: { id: body.locationId.trim() },
    select: { id: true, branchId: true },
  });

  if (!location) {
    return NextResponse.json({ message: "Receive location not found" }, { status: 404 });
  }

  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      items: true,
    },
  });

  if (!po) {
    return NextResponse.json({ message: "Purchase order not found" }, { status: 404 });
  }

  if (po.status === "RECEIVED" || po.status === "CANCELLED") {
    return NextResponse.json({ message: `Cannot receive PO with status ${po.status}` }, { status: 400 });
  }

  let didReceiveAny = false;

  await prisma.$transaction(async (tx) => {
    for (const item of po.items) {
      const remaining = item.orderedQty - item.receivedQty;
      if (remaining <= 0) continue;

      didReceiveAny = true;
      const newReceivedQty = item.receivedQty + remaining;
      await tx.pOItem.update({
        where: { id: item.id },
        data: { receivedQty: newReceivedQty },
      });

      const existingStock = await tx.stockLevel.findFirst({
        where: {
          productId: item.productId,
          locationId: body.locationId,
        },
      });

      const previousQty = existingStock?.quantity ?? 0;
      const newQty = previousQty + remaining;

      if (existingStock) {
        await tx.stockLevel.update({
          where: { id: existingStock.id },
          data: { quantity: newQty },
        });
      } else {
        await tx.stockLevel.create({
          data: {
            productId: item.productId,
            locationId: body.locationId,
            quantity: newQty,
          },
        });
      }

      const actingUserId = body.userId?.trim() || auth.user.id;
      const stockMovement = await tx.stockMovement.create({
        data: {
          productId: item.productId,
          locationId: location.id,
          type: "PURCHASE",
          quantity: remaining,
          previousQty,
          newQty,
          reason: "PO receive",
          referenceId: po.id,
          userId: actingUserId,
        },
      });

      await createInventoryCostLayer(tx, {
        productId: item.productId,
        locationId: location.id,
        branchId: location.branchId,
        poItemId: item.id,
        sourceType: "PURCHASE",
        sourceId: stockMovement.id,
        quantity: remaining,
        unitCost: Number(item.unitCost),
        receivedAt: stockMovement.createdAt,
      });
    }

    if (!didReceiveAny) return;

    const refreshedItems = await tx.pOItem.findMany({
      where: { poId: po.id },
      select: { orderedQty: true, receivedQty: true },
    });
    const fullyReceived = refreshedItems.every((item) => item.receivedQty >= item.orderedQty);

    await tx.purchaseOrder.update({
      where: { id: po.id },
      data: {
        branchId: po.branchId ?? location.branchId,
        status: fullyReceived ? "RECEIVED" : "PARTIAL",
        receivedDate: new Date(),
      },
    });
  });

  if (!didReceiveAny) {
    return NextResponse.json({ message: "Nothing left to receive on this PO" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
