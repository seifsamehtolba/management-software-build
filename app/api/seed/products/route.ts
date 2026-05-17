import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const tier = req.nextUrl.searchParams.get("tier");
  const limit = Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "500", 10);
  const branchId = req.nextUrl.searchParams.get("branchId");

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
    },
    orderBy: tier === "1" ? { salesRank: "desc" } : undefined,
    take: limit,
    include: {
      category: { select: { name: true } },
      brand: { select: { name: true } },
    },
  });

  const flat = products.map((p) => ({
    id: p.id,
    sku: p.sku,
    barcode: p.barcode ?? undefined,
    name: p.name,
    nameAr: p.nameAr ?? undefined,
    categoryId: p.categoryId,
    categoryName: p.category.name,
    brandName: p.brand?.name ?? undefined,
    sellPrice: Number(p.sellPrice),
    costPrice: Number(p.costPrice),
    taxRate: Number(p.taxRate),
    hasSerials: p.hasSerials,
    salesRank: p.salesRank,
    syncStatus: "synced" as const,
    updatedAt: p.updatedAt.toISOString(),
  }));

  return NextResponse.json(flat);
}
