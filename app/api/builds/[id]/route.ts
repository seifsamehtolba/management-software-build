import { NextRequest, NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { logActivity } from "@/lib/activity";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireApiAnyPermission([PERMISSIONS.buildsRead, PERMISSIONS.buildsCreate]);
  if (!auth.ok) return auth.response;

  const { id } = await params;

  const build = await prisma.buildOrder.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, phone: true, email: true } },
      technician: { select: { id: true, name: true } },
      parts: {
        include: {
          product: { select: { id: true, name: true, sku: true, sellPrice: true, costPrice: true } },
        },
      },
      convertedSale: { select: { id: true, invoiceNumber: true } },
    },
  });

  if (!build) return NextResponse.json({ message: "Build order not found" }, { status: 404 });

  return NextResponse.json({
    id: build.id,
    buildNumber: build.buildNumber,
    title: build.title,
    status: build.status,
    customer: build.customer,
    technician: build.technician,
    estimatedCost: build.estimatedCost == null ? null : Number(build.estimatedCost),
    laborCost: build.laborCost == null ? null : Number(build.laborCost),
    finalCost: build.finalCost == null ? null : Number(build.finalCost),
    notes: build.notes,
    convertedSale: build.convertedSale,
    deliveredAt: build.deliveredAt?.toISOString() ?? null,
    createdAt: build.createdAt.toISOString(),
    updatedAt: build.updatedAt.toISOString(),
    parts: build.parts.map((p) => ({
      id: p.id,
      productId: p.productId,
      productName: p.product.name,
      productSku: p.product.sku,
      sellPrice: Number(p.product.sellPrice),
      costPrice: Number(p.product.costPrice),
      quantity: p.quantity,
      unitCost: Number(p.unitCost),
      note: p.note,
    })),
  });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireApiAnyPermission([PERMISSIONS.buildsUpdate]);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    status?: string;
    title?: string;
    technicianId?: string | null;
    estimatedCost?: number | null;
    laborCost?: number | null;
    finalCost?: number | null;
    notes?: string;
    parts?: Array<{ productId: string; quantity: number; unitCost: number; note?: string }>;
  };

  const build = await prisma.buildOrder.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!build) return NextResponse.json({ message: "Build order not found" }, { status: 404 });
  if (build.status === "DELIVERED" || build.status === "CANCELLED") {
    return NextResponse.json({ message: "Cannot update a delivered or cancelled build" }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    if (body.parts !== undefined) {
      await tx.buildOrderPart.deleteMany({ where: { buildOrderId: id } });
      if (body.parts.length > 0) {
        await tx.buildOrderPart.createMany({
          data: body.parts.map((p) => ({
            buildOrderId: id,
            productId: p.productId,
            quantity: p.quantity,
            unitCost: p.unitCost,
            note: p.note?.trim() || null,
          })),
        });
      }
    }

    await tx.buildOrder.update({
      where: { id },
      data: {
        ...(body.status ? { status: body.status as never } : {}),
        ...(body.title !== undefined ? { title: body.title.trim() } : {}),
        ...(body.technicianId !== undefined ? { technicianId: body.technicianId || null } : {}),
        ...(body.estimatedCost !== undefined ? { estimatedCost: body.estimatedCost } : {}),
        ...(body.laborCost !== undefined ? { laborCost: body.laborCost } : {}),
        ...(body.finalCost !== undefined ? { finalCost: body.finalCost } : {}),
        ...(body.notes !== undefined ? { notes: body.notes.trim() || null } : {}),
        ...(body.status === "DELIVERED" ? { deliveredAt: new Date() } : {}),
      },
    });
  });

  await logActivity({
    userId: auth.user.id,
    action: "BUILD_UPDATED",
    tableName: "BuildOrder",
    recordId: id,
    details: { status: body.status },
  });

  return NextResponse.json({ ok: true });
}
