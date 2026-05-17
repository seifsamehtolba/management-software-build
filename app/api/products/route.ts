import { NextRequest, NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  const branchId = req.nextUrl.searchParams.get("branchId")?.trim();

  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      ...(branchId
        ? {
            stockLevels: {
              some: {
                location: {
                  branchId,
                },
              },
            },
          }
        : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              { sku: { contains: q } },
              { barcode: { contains: q } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      category: { select: { name: true } },
      brand: { select: { name: true } },
    },
  });

  return NextResponse.json(
    products.map((p) => ({
      id: p.id,
      sku: p.sku,
      barcode: p.barcode,
      name: p.name,
      categoryId: p.categoryId,
      categoryName: p.category.name,
      brandId: p.brandId,
      brandName: p.brand?.name ?? null,
      costPrice: Number(p.costPrice),
      sellPrice: Number(p.sellPrice),
      taxRate: Number(p.taxRate),
      hasSerials: p.hasSerials,
      isActive: p.isActive,
      componentCategory: p.componentCategory,
      specs: p.specs,
      externalRef: p.externalRef,
      suggestedPriceUsd: p.suggestedPriceUsd ? Number(p.suggestedPriceUsd) : null,
      imageUrl: p.imageUrl,
      updatedAt: p.updatedAt.toISOString(),
    })),
  );
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAnyPermission([PERMISSIONS.productsCreate]);
  if (!auth.ok) return auth.response;

  const body = (await req.json()) as {
    sku: string;
    barcode?: string;
    name: string;
    categoryId: string;
    brandId?: string | null;
    costPrice: number;
    sellPrice: number;
    taxRate?: number;
    hasSerials?: boolean;
  };

  if (!body.sku || !body.name || !body.categoryId) {
    return NextResponse.json({ message: "sku, name, and categoryId are required" }, { status: 400 });
  }

  const product = await prisma.product.create({
    data: {
      sku: body.sku.trim(),
      barcode: body.barcode?.trim() || null,
      name: body.name.trim(),
      categoryId: body.categoryId.trim(),
      brandId: body.brandId?.trim() || null,
      costPrice: body.costPrice,
      sellPrice: body.sellPrice,
      taxRate: body.taxRate ?? 0.14,
      hasSerials: body.hasSerials ?? false,
    },
  });

  return NextResponse.json({ id: product.id }, { status: 201 });
}
