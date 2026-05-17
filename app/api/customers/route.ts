import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CustomerType, Prisma } from "@prisma/client";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const createCustomerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(6).max(40),
  email: z.string().trim().email().max(120).optional().or(z.literal("")),
  address: z.string().trim().max(300).optional().or(z.literal("")),
  nationalId: z.string().trim().max(80).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  type: z.enum(["REGULAR", "VIP", "WHOLESALE"]).optional(),
});

export async function GET(req: NextRequest) {
  const auth = await requireApiAnyPermission([PERMISSIONS.customersRead]);
  if (!auth.ok) return auth.response;

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const typeParam = req.nextUrl.searchParams.get("type")?.trim() ?? "";
  const includeBlacklisted = req.nextUrl.searchParams.get("includeBlacklisted") === "1";
  const inDebt = req.nextUrl.searchParams.get("inDebt") === "1";
  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get("pageSize") ?? "25") || 25));
  const skip = (page - 1) * pageSize;

  const typeFilter: CustomerType | undefined =
    typeParam === "REGULAR" || typeParam === "VIP" || typeParam === "WHOLESALE"
      ? (typeParam as CustomerType)
      : undefined;

  const where: Prisma.CustomerWhereInput = {
    ...(includeBlacklisted ? {} : { isBlacklisted: false }),
    ...(typeFilter ? { type: typeFilter } : {}),
    ...(inDebt ? { creditBalance: { lt: 0 } } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q } },
            { phone: { contains: q } },
            { email: { contains: q } },
            { address: { contains: q } },
          ],
        }
      : {}),
  };

  const [totalCount, customers] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip,
      take: pageSize,
      include: {
        _count: {
          select: {
            sales: true,
            quotes: true,
            repairTickets: true,
          },
        },
      },
    }),
  ]);

  return NextResponse.json({
    rows: customers.map((customer) => ({
      ...customer,
      creditBalance: Number(customer.creditBalance),
      createdAt: customer.createdAt.toISOString(),
      updatedAt: customer.updatedAt.toISOString(),
      riskLevel: customer.isBlacklisted
        ? "HIGH"
        : Number(customer.creditBalance) > 10_000
          ? "MEDIUM"
          : "LOW",
    })),
    page,
    pageSize,
    totalCount,
    pageCount: Math.max(1, Math.ceil(totalCount / pageSize)),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAnyPermission([PERMISSIONS.customersCreate]);
  if (!auth.ok) return auth.response;

  const parsed = createCustomerSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid customer payload" },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const existingByPhone = await prisma.customer.findUnique({
    where: { phone: data.phone },
  });
  if (existingByPhone) {
    return NextResponse.json(
      { message: "A customer with this phone already exists", customerId: existingByPhone.id },
      { status: 409 },
    );
  }

  const customer = await prisma.customer.create({
    data: {
      name: data.name,
      phone: data.phone,
      email: data.email || null,
      address: data.address || null,
      nationalId: data.nationalId || null,
      notes: data.notes || null,
      type: data.type ?? "REGULAR",
    },
  });

  return NextResponse.json(
    {
      ...customer,
      creditBalance: Number(customer.creditBalance),
      createdAt: customer.createdAt.toISOString(),
      updatedAt: customer.updatedAt.toISOString(),
    },
    { status: 201 },
  );
}
