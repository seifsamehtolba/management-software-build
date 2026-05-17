import { NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const locations = await prisma.location.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      branchId: true,
    },
  });
  return NextResponse.json(locations);
}

export async function POST(req: Request) {
  const auth = await requireApiAnyPermission([PERMISSIONS.locationsCreate]);
  if (!auth.ok) return auth.response;

  const body = (await req.json()) as {
    name?: string;
    branchId?: string | null;
  };

  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ message: "Warehouse name is required" }, { status: 400 });
  }

  const location = await prisma.location.create({
    data: {
      name,
      branchId: body.branchId?.trim() || null,
    },
    select: {
      id: true,
      name: true,
      branchId: true,
    },
  });
  return NextResponse.json(location, { status: 201 });
}
