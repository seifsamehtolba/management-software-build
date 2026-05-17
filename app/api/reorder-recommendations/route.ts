import { NextRequest, NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

export async function GET(req: NextRequest) {
  const auth = await requireApiAnyPermission([PERMISSIONS.reportsDashboardRead, PERMISSIONS.productsUpdate]);
  if (!auth.ok) return auth.response;

  const branchId = req.nextUrl.searchParams.get("branchId")?.trim() || null;

  const [stockLevels, saleItems] = await Promise.all([
    prisma.stockLevel.findMany({
      where: branchId ? { location: { branchId } } : undefined,
      include: {
        location: { select: { branchId: true, name: true } },
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            reorderPoint: true,
            costPrice: true,
            sellPrice: true,
          },
        },
      },
    }),
    prisma.saleItem.findMany({
      where: {
        sale: {
          status: "COMPLETED",
          createdAt: { gte: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000) },
          ...(branchId ? { cashier: { branchId } } : {}),
        },
      },
      select: {
        productId: true,
        quantity: true,
      },
    }),
  ]);

  const soldByProduct = new Map<string, number>();
  for (const saleItem of saleItems) {
    soldByProduct.set(saleItem.productId, (soldByProduct.get(saleItem.productId) ?? 0) + saleItem.quantity);
  }

  const rows = stockLevels
    .map((stockLevel) => {
      const sold45Days = soldByProduct.get(stockLevel.productId) ?? 0;
      const dailyRunRate = sold45Days / 45;
      const recommendedQty = Math.max(
        stockLevel.product.reorderPoint,
        Math.ceil(dailyRunRate * 21),
      );
      const gapQty = Math.max(0, recommendedQty - stockLevel.quantity);
      return {
        productId: stockLevel.product.id,
        productName: stockLevel.product.name,
        sku: stockLevel.product.sku,
        locationName: stockLevel.location.name,
        onHand: stockLevel.quantity,
        reorderPoint: stockLevel.product.reorderPoint,
        sold45Days,
        dailyRunRate: Number(dailyRunRate.toFixed(2)),
        recommendedQty,
        gapQty,
        estimatedBuyCost: roundMoney(gapQty * Number(stockLevel.product.costPrice)),
        estimatedRevenue: roundMoney(gapQty * Number(stockLevel.product.sellPrice)),
      };
    })
    .filter((row) => row.gapQty > 0)
    .sort((a, b) => b.gapQty - a.gapQty)
    .slice(0, 50);

  return NextResponse.json({ rows });
}
