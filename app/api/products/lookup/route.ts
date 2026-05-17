import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q")?.trim();
  if (!query) {
    return NextResponse.json({ message: "Missing q query param" }, { status: 400 });
  }

  const product = await prisma.product.findFirst({
    where: {
      isActive: true,
      OR: [{ barcode: query }, { sku: query }, { name: { contains: query } }],
    },
    include: {
      category: { select: { name: true } },
      brand: { select: { name: true } },
    },
  });

  if (!product) {
    return NextResponse.json({ message: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: product.id,
    sku: product.sku,
    barcode: product.barcode ?? undefined,
    name: product.name,
    nameAr: product.nameAr ?? undefined,
    categoryId: product.categoryId,
    categoryName: product.category.name,
    brandName: product.brand?.name ?? undefined,
    sellPrice: Number(product.sellPrice),
    costPrice: Number(product.costPrice),
    taxRate: Number(product.taxRate),
    hasSerials: product.hasSerials,
    salesRank: product.salesRank,
    syncStatus: "synced" as const,
    updatedAt: product.updatedAt.toISOString(),
  });
}
