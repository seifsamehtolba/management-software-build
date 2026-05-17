import { NextRequest, NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { consumeInventoryCost, createInventoryCostLayer } from "@/lib/inventoryCosting";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const auth = await requireApiAnyPermission([PERMISSIONS.stockAdjust]);
  if (!auth.ok) return auth.response;

  const body = (await req.json()) as {
    productId?: string;
    locationId?: string;
    delta?: number;
    reason?: string;
    unitCost?: number;
  };

  const productId = body.productId?.trim();
  const locationId = body.locationId?.trim();
  const delta = Number(body.delta);
  const unitCost = body.unitCost === undefined ? undefined : Number(body.unitCost);

  if (!productId || !locationId || !Number.isInteger(delta) || delta === 0) {
    return NextResponse.json({ message: "productId, locationId, and non-zero integer delta are required" }, { status: 400 });
  }

  if (delta > 0 && (unitCost === undefined || !Number.isFinite(unitCost) || unitCost < 0)) {
    return NextResponse.json({ message: "unitCost is required for positive stock adjustments" }, { status: 400 });
  }

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.stockLevel.findFirst({
      where: { productId, locationId },
      select: { id: true, quantity: true },
    });

    const previousQty = existing?.quantity ?? 0;
    const newQty = previousQty + delta;
    if (newQty < 0) {
      return { ok: false as const, message: "Cannot reduce below zero stock." };
    }

    if (existing) {
      await tx.stockLevel.update({
        where: { id: existing.id },
        data: { quantity: newQty },
      });
    } else {
      await tx.stockLevel.create({
        data: {
          productId,
          locationId,
          quantity: newQty,
        },
      });
    }

    const movement = await tx.stockMovement.create({
      data: {
        productId,
        locationId,
        type: "ADJUSTMENT",
        quantity: delta,
        previousQty,
        newQty,
        reason: body.reason?.trim() || "Manual inventory adjustment",
        userId: auth.user.id,
      },
    });

    if (delta > 0) {
      const location = await tx.location.findUnique({
        where: { id: locationId },
        select: { branchId: true },
      });
      await createInventoryCostLayer(tx, {
        productId,
        locationId,
        branchId: location?.branchId ?? null,
        sourceType: "ADJUSTMENT",
        sourceId: movement.id,
        quantity: delta,
        unitCost: unitCost ?? 0,
        receivedAt: movement.createdAt,
      });
    } else {
      await consumeInventoryCost(tx, {
        productId,
        locationId,
        quantity: Math.abs(delta),
        occurredAt: movement.createdAt,
        reason: "ADJUSTMENT_LOSS",
        stockMovementId: movement.id,
      });
    }

    return { ok: true as const, previousQty, newQty };
  });

  if (!result.ok) {
    return NextResponse.json({ message: result.message }, { status: 400 });
  }

  return NextResponse.json(result);
}
