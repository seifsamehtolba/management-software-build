import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const customers = await prisma.customer.findMany({
    where: { isBlacklisted: false },
    select: {
      id: true,
      name: true,
      phone: true,
      creditBalance: true,
      loyaltyPoints: true,
      type: true,
      updatedAt: true,
    },
  });

  return NextResponse.json(
    customers.map((c) => ({
      ...c,
      creditBalance: Number(c.creditBalance),
      syncStatus: "synced",
      updatedAt: c.updatedAt.toISOString(),
    })),
  );
}
