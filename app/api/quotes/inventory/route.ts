import { NextRequest, NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { branchScope } from "@/lib/quotes";

type PriceOption = {
  unitCost: number;
  receivedQty: number;
  lastReceivedAt: string | null;
};

export async function GET(req: NextRequest) {
  const auth = await requireApiAnyPermission([PERMISSIONS.inventoryReadForQuotes]);
  if (!auth.ok) return auth.response;

  const q = req.nextUrl.searchParams.get("q")?.trim();
  const requestedBranchId = req.nextUrl.searchParams.get("branchId")?.trim() ?? "";
  const effectiveBranchId = branchScope(auth.user, requestedBranchId, PERMISSIONS.inventoryCrossBranch);

  const products = await prisma.product.findMany({
    where: {
      isActive: true,
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
    orderBy: { updatedAt: "desc" },
    take: 60,
    include: {
      category: { select: { name: true } },
      stockLevels: {
        where: {
          ...(effectiveBranchId ? { location: { branchId: effectiveBranchId } } : {}),
        },
        select: {
          quantity: true,
          location: {
            select: {
              id: true,
              name: true,
              branchId: true,
              branch: { select: { id: true, name: true } },
            },
          },
        },
      },
      poItems: {
        where: { receivedQty: { gt: 0 } },
        select: {
          unitCost: true,
          receivedQty: true,
          po: { select: { receivedDate: true, createdAt: true } },
        },
      },
    },
  });

  return NextResponse.json(
    products.map((product) => {
      const availableQty = product.stockLevels.reduce((sum, level) => sum + level.quantity, 0);

      const optionsMap = new Map<string, PriceOption>();
      product.poItems.forEach((item) => {
        const key = Number(item.unitCost).toFixed(2);
        const existing = optionsMap.get(key);
        const candidateDate = item.po.receivedDate ?? item.po.createdAt;
        if (!existing) {
          optionsMap.set(key, {
            unitCost: Number(item.unitCost),
            receivedQty: item.receivedQty,
            lastReceivedAt: candidateDate?.toISOString() ?? null,
          });
          return;
        }

        existing.receivedQty += item.receivedQty;
        if (candidateDate && (!existing.lastReceivedAt || new Date(candidateDate) > new Date(existing.lastReceivedAt))) {
          existing.lastReceivedAt = candidateDate.toISOString();
        }
      });

      const purchasePriceOptions = Array.from(optionsMap.values()).sort((a, b) => {
        if (a.unitCost !== b.unitCost) return a.unitCost - b.unitCost;
        const aTime = a.lastReceivedAt ? new Date(a.lastReceivedAt).getTime() : 0;
        const bTime = b.lastReceivedAt ? new Date(b.lastReceivedAt).getTime() : 0;
        return bTime - aTime;
      });

      return {
        id: product.id,
        sku: product.sku,
        barcode: product.barcode,
        name: product.name,
        categoryName: product.category.name,
        componentCategory: product.componentCategory,
        sellPrice: Number(product.sellPrice),
        availableQty,
        stockByLocation: product.stockLevels.map((level) => ({
          locationId: level.location.id,
          locationName: level.location.name,
          branchId: level.location.branchId,
          branchName: level.location.branch?.name ?? null,
          quantity: level.quantity,
        })),
        purchasePriceOptions,
      };
    }),
  );
}
