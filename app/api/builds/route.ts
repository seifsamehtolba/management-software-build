import { NextRequest, NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { logActivity } from "@/lib/activity";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

function buildNumber() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `BLD-${yy}${mm}${dd}-${rand}`;
}

export async function GET(req: NextRequest) {
  const auth = await requireApiAnyPermission([PERMISSIONS.buildsRead, PERMISSIONS.buildsCreate]);
  if (!auth.ok) return auth.response;

  const status = req.nextUrl.searchParams.get("status")?.trim() || undefined;
  const search = req.nextUrl.searchParams.get("search")?.trim() || undefined;

  const rows = await prisma.buildOrder.findMany({
    where: {
      ...(status ? { status: status as never } : {}),
      ...(search
        ? {
            OR: [
              { buildNumber: { contains: search } },
              { customer: { name: { contains: search } } },
              { title: { contains: search } },
            ],
          }
        : {}),
    },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      technician: { select: { id: true, name: true } },
      parts: {
        include: { product: { select: { id: true, name: true, sku: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json(
    rows.map((row) => ({
      id: row.id,
      buildNumber: row.buildNumber,
      title: row.title,
      status: row.status,
      customer: row.customer,
      technician: row.technician,
      estimatedCost: row.estimatedCost == null ? null : Number(row.estimatedCost),
      laborCost: row.laborCost == null ? null : Number(row.laborCost),
      finalCost: row.finalCost == null ? null : Number(row.finalCost),
      notes: row.notes,
      convertedSaleId: row.convertedSaleId,
      deliveredAt: row.deliveredAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      parts: row.parts.map((p) => ({
        id: p.id,
        productId: p.productId,
        productName: p.product.name,
        productSku: p.product.sku,
        quantity: p.quantity,
        unitCost: Number(p.unitCost),
        note: p.note,
      })),
    })),
  );
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAnyPermission([PERMISSIONS.buildsCreate]);
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    customerId?: string;
    technicianId?: string;
    estimatedCost?: number;
    laborCost?: number;
    notes?: string;
    parts?: Array<{ productId: string; quantity: number; unitCost: number; note?: string }>;
  };

  const title = body.title?.trim();
  const customerId = body.customerId?.trim();
  if (!title || !customerId) {
    return NextResponse.json({ message: "title and customerId are required" }, { status: 400 });
  }

  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
  if (!customer) return NextResponse.json({ message: "Customer not found" }, { status: 404 });

  const bn = buildNumber();

  const build = await prisma.buildOrder.create({
    data: {
      buildNumber: bn,
      title,
      customerId,
      technicianId: body.technicianId?.trim() || null,
      estimatedCost: body.estimatedCost != null ? body.estimatedCost : null,
      laborCost: body.laborCost != null ? body.laborCost : null,
      notes: body.notes?.trim() || null,
      parts: body.parts?.length
        ? {
            create: body.parts.map((p) => ({
              productId: p.productId,
              quantity: p.quantity,
              unitCost: p.unitCost,
              note: p.note?.trim() || null,
            })),
          }
        : undefined,
    },
  });

  await logActivity({
    userId: auth.user.id,
    action: "BUILD_CREATED",
    tableName: "BuildOrder",
    recordId: build.id,
    details: { buildNumber: bn, title, customerId },
  });

  return NextResponse.json({ id: build.id, buildNumber: bn }, { status: 201 });
}
