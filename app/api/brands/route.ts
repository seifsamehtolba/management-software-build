import { NextRequest, NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  const brands = await prisma.brand.findMany({
    where: q ? { name: { contains: q } } : undefined,
    orderBy: { name: "asc" },
    take: 200,
    select: { id: true, name: true },
  });
  return NextResponse.json(brands);
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAnyPermission([PERMISSIONS.catalogBrandsCreate]);
  if (!auth.ok) return auth.response;

  const body = (await req.json()) as { name: string };
  if (!body.name?.trim()) {
    return NextResponse.json({ message: "name is required" }, { status: 400 });
  }
  const brand = await prisma.brand.create({
    data: { name: body.name.trim() },
    select: { id: true, name: true },
  });
  return NextResponse.json(brand, { status: 201 });
}
