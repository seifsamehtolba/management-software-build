import { NextRequest, NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  const suppliers = await prisma.supplier.findMany({
    where: q
      ? {
          OR: [
            { name: { contains: q } },
            { phone: { contains: q } },
            { email: { contains: q } },
          ],
        }
      : undefined,
    orderBy: { name: "asc" },
    take: 200,
  });
  return NextResponse.json(
    suppliers.map((s) => ({
      ...s,
      outstandingBalance: Number(s.outstandingBalance),
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    })),
  );
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAnyPermission([PERMISSIONS.suppliersCreate]);
  if (!auth.ok) return auth.response;

  const body = (await req.json()) as {
    name: string;
    contactName?: string;
    phone?: string;
    email?: string;
    address?: string;
    paymentTerms?: string;
  };

  if (!body.name?.trim()) {
    return NextResponse.json({ message: "name is required" }, { status: 400 });
  }

  const supplier = await prisma.supplier.create({
    data: {
      name: body.name.trim(),
      contactName: body.contactName?.trim() || null,
      phone: body.phone?.trim() || null,
      email: body.email?.trim() || null,
      address: body.address?.trim() || null,
      paymentTerms: body.paymentTerms?.trim() || null,
    },
  });
  return NextResponse.json({ id: supplier.id }, { status: 201 });
}
