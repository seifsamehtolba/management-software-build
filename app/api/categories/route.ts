import { NextRequest, NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  const categories = await prisma.category.findMany({
    where: q
      ? {
          OR: [{ name: { contains: q } }, { nameAr: { contains: q } }],
        }
      : undefined,
    orderBy: { name: "asc" },
    take: 200,
    select: { id: true, name: true, nameAr: true },
  });
  return NextResponse.json(categories);
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAnyPermission([PERMISSIONS.catalogCategoriesCreate]);
  if (!auth.ok) return auth.response;

  const body = (await req.json()) as { name: string; nameAr?: string };
  if (!body.name?.trim()) {
    return NextResponse.json({ message: "name is required" }, { status: 400 });
  }
  const category = await prisma.category.create({
    data: {
      name: body.name.trim(),
      nameAr: body.nameAr?.trim() || null,
    },
    select: { id: true, name: true, nameAr: true },
  });
  return NextResponse.json(category, { status: 201 });
}
