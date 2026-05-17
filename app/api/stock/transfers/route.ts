import { NextRequest, NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { logActivity } from "@/lib/activity";
import { PERMISSIONS, hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

function buildTransferNumber(now = new Date()) {
  const datePart = now.toISOString().slice(0, 10).replaceAll("-", "");
  const randomPart = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
  return `TR-${datePart}-${randomPart}`;
}

function canCrossBranch(permissions: string[]) {
  return hasPermission(permissions, PERMISSIONS.inventoryCrossBranch) || hasPermission(permissions, PERMISSIONS.branchesReadAll);
}

type CreateTransferItem = {
  productId?: string;
  quantity?: number;
};

export async function GET(req: NextRequest) {
  const auth = await requireApiAnyPermission([PERMISSIONS.stockTransfersRead, PERMISSIONS.stockTransfersManage]);
  if (!auth.ok) return auth.response;

  const requestedBranchId = req.nextUrl.searchParams.get("branchId")?.trim() ?? "";
  const effectiveBranchId = canCrossBranch(auth.user.permissions) ? requestedBranchId || null : auth.user.branchId;

  const transfers = await prisma.stockTransfer.findMany({
    where: effectiveBranchId
      ? {
          OR: [{ fromBranchId: effectiveBranchId }, { toBranchId: effectiveBranchId }],
        }
      : undefined,
    include: {
      fromBranch: { select: { id: true, name: true } },
      toBranch: { select: { id: true, name: true } },
      fromLocation: { select: { id: true, name: true } },
      toLocation: { select: { id: true, name: true } },
      requestedBy: { select: { id: true, name: true } },
      shippedBy: { select: { id: true, name: true } },
      receivedBy: { select: { id: true, name: true } },
      items: {
        include: {
          product: { select: { id: true, name: true, sku: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json(
    transfers.map((transfer) => ({
      id: transfer.id,
      transferNumber: transfer.transferNumber,
      status: transfer.status,
      notes: transfer.notes,
      fromBranch: transfer.fromBranch,
      toBranch: transfer.toBranch,
      fromLocation: transfer.fromLocation,
      toLocation: transfer.toLocation,
      requestedBy: transfer.requestedBy,
      shippedBy: transfer.shippedBy,
      receivedBy: transfer.receivedBy,
      shippedAt: transfer.shippedAt?.toISOString() ?? null,
      receivedAt: transfer.receivedAt?.toISOString() ?? null,
      createdAt: transfer.createdAt.toISOString(),
      items: transfer.items.map((item) => ({
        id: item.id,
        product: item.product,
        quantity: item.quantity,
        shippedQty: item.shippedQty,
        receivedQty: item.receivedQty,
        unitCostSnapshot: item.unitCostSnapshot == null ? null : Number(item.unitCostSnapshot),
        totalCostSnapshot: item.totalCostSnapshot == null ? null : Number(item.totalCostSnapshot),
      })),
    })),
  );
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAnyPermission([PERMISSIONS.stockTransfersManage]);
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => ({}))) as {
    fromBranchId?: string;
    toBranchId?: string;
    fromLocationId?: string;
    toLocationId?: string;
    notes?: string;
    items?: CreateTransferItem[];
  };

  const items = Array.isArray(body.items) ? body.items : [];
  if (!body.fromBranchId || !body.toBranchId || !body.fromLocationId || !body.toLocationId || items.length === 0) {
    return NextResponse.json({ message: "Branch, location, and item details are required" }, { status: 400 });
  }
  if (body.fromBranchId === body.toBranchId) {
    return NextResponse.json({ message: "Transfer branches must be different" }, { status: 400 });
  }

  if (!canCrossBranch(auth.user.permissions) && body.fromBranchId !== auth.user.branchId) {
    return NextResponse.json({ message: "You can only request transfers from your own branch" }, { status: 403 });
  }

  const transfer = await prisma.stockTransfer.create({
    data: {
      transferNumber: buildTransferNumber(),
      fromBranchId: body.fromBranchId,
      toBranchId: body.toBranchId,
      fromLocationId: body.fromLocationId,
      toLocationId: body.toLocationId,
      notes: body.notes?.trim() || null,
      requestedById: auth.user.id,
      items: {
        create: items.map((item) => ({
          productId: item.productId!,
          quantity: Math.max(1, Math.trunc(Number(item.quantity ?? 0))),
        })),
      },
    },
  });

  await logActivity({
    userId: auth.user.id,
    action: "STOCK_TRANSFER_CREATED",
    tableName: "StockTransfer",
    recordId: transfer.id,
    details: { fromBranchId: body.fromBranchId, toBranchId: body.toBranchId, itemCount: items.length },
  });

  return NextResponse.json({ id: transfer.id, transferNumber: transfer.transferNumber }, { status: 201 });
}
