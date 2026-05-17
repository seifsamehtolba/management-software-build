import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  const { id } = await params;
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      items: {
        include: {
          product: { select: { id: true, name: true, sku: true } },
        },
      },
      payments: true,
    },
  });

  if (!po) {
    return NextResponse.json({ message: "Purchase order not found" }, { status: 404 });
  }

  return NextResponse.json({
    ...po,
    subtotal: Number(po.subtotal),
    taxAmount: Number(po.taxAmount),
    total: Number(po.total),
    paidAmount: Number(po.paidAmount),
    createdAt: po.createdAt.toISOString(),
    updatedAt: po.updatedAt.toISOString(),
    expectedDate: po.expectedDate ? po.expectedDate.toISOString() : null,
    dueDate: po.dueDate ? po.dueDate.toISOString() : null,
    receivedDate: po.receivedDate ? po.receivedDate.toISOString() : null,
    items: po.items.map((item) => ({
      ...item,
      unitCost: Number(item.unitCost),
      total: Number(item.total),
    })),
    payments: po.payments.map((p) => ({
      ...p,
      amount: Number(p.amount),
      paidAt: p.paidAt.toISOString(),
      reversedAt: p.reversedAt ? p.reversedAt.toISOString() : null,
    })),
  });
}
