import { NextRequest, NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();

  const purchaseOrders = await prisma.purchaseOrder.findMany({
    where: q
      ? {
          OR: [
            { poNumber: { contains: q } },
            { supplier: { name: { contains: q } } },
          ],
        }
      : undefined,
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      supplier: { select: { id: true, name: true } },
      items: true,
    },
  });

  return NextResponse.json(
    purchaseOrders.map((po) => ({
      id: po.id,
      poNumber: po.poNumber,
      supplierId: po.supplierId,
      supplierName: po.supplier.name,
      status: po.status,
      subtotal: Number(po.subtotal),
      taxAmount: Number(po.taxAmount),
      total: Number(po.total),
      paidAmount: Number(po.paidAmount),
      createdAt: po.createdAt.toISOString(),
      items: po.items.map((item) => ({
        ...item,
        unitCost: Number(item.unitCost),
        total: Number(item.total),
      })),
    })),
  );
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAnyPermission([PERMISSIONS.purchaseOrdersCreate]);
  if (!auth.ok) return auth.response;

  const body = (await req.json()) as {
    supplierId: string;
    items: Array<{ productId: string; orderedQty: number; unitCost: number }>;
    expectedDate?: string;
    dueDate?: string;
    notes?: string;
  };

  if (!body.supplierId || !body.items?.length) {
    return NextResponse.json({ message: "supplierId and items are required" }, { status: 400 });
  }

  const subtotal = body.items.reduce((sum, item) => sum + item.orderedQty * item.unitCost, 0);
  const taxAmount = 0;
  const total = subtotal + taxAmount;
  const now = new Date();
  const poNumber = `PO-${now.toISOString().slice(0, 10).replaceAll("-", "")}-${Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, "0")}`;

  const po = await prisma.purchaseOrder.create({
    data: {
      poNumber,
      supplierId: body.supplierId,
      branchId: auth.user.branchId ?? null,
      expectedDate: body.expectedDate ? new Date(body.expectedDate) : null,
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      notes: body.notes?.trim() || null,
      subtotal,
      taxAmount,
      total,
      items: {
        create: body.items.map((item) => ({
          productId: item.productId,
          orderedQty: item.orderedQty,
          unitCost: item.unitCost,
          total: item.orderedQty * item.unitCost,
        })),
      },
    },
  });

  await prisma.supplier.update({
    where: { id: body.supplierId },
    data: {
      outstandingBalance: {
        increment: total,
      },
    },
  });

  return NextResponse.json({ id: po.id, poNumber: po.poNumber }, { status: 201 });
}
