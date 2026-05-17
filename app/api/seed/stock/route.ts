import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const branchId = req.nextUrl.searchParams.get("branchId");

  const stock = await prisma.stockLevel.findMany({
    where: branchId
      ? {
          location: {
            branchId,
          },
        }
      : undefined,
    select: {
      id: true,
      productId: true,
      locationId: true,
      quantity: true,
      updatedAt: true,
    },
  });

  return NextResponse.json(
    stock.map((item) => ({
      ...item,
      syncStatus: "synced",
      updatedAt: item.updatedAt.toISOString(),
    })),
  );
}
