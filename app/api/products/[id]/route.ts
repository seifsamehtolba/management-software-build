import { NextRequest, NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireApiAnyPermission([PERMISSIONS.productsUpdate]);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = (await req.json()) as {
    sku?: string;
    barcode?: string | null;
    name?: string;
    categoryId?: string;
    brandId?: string | null;
    costPrice?: number;
    sellPrice?: number;
    taxRate?: number;
    hasSerials?: boolean;
    isActive?: boolean;
  };

  const updated = await prisma.product.update({
    where: { id },
    data: {
      ...(body.sku !== undefined ? { sku: body.sku.trim() } : {}),
      ...(body.barcode !== undefined ? { barcode: body.barcode?.trim() || null } : {}),
      ...(body.name !== undefined ? { name: body.name.trim() } : {}),
      ...(body.categoryId !== undefined ? { categoryId: body.categoryId.trim() } : {}),
      ...(body.brandId !== undefined ? { brandId: body.brandId?.trim() || null } : {}),
      ...(body.costPrice !== undefined ? { costPrice: body.costPrice } : {}),
      ...(body.sellPrice !== undefined ? { sellPrice: body.sellPrice } : {}),
      ...(body.taxRate !== undefined ? { taxRate: body.taxRate } : {}),
      ...(body.hasSerials !== undefined ? { hasSerials: body.hasSerials } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
    },
  });

  return NextResponse.json({ id: updated.id });
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const auth = await requireApiAnyPermission([PERMISSIONS.productsArchive]);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  await prisma.product.update({
    where: { id },
    data: { isActive: false },
  });
  return NextResponse.json({ ok: true });
}
