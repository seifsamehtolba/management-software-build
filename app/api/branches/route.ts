import { NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const auth = await requireApiAnyPermission([PERMISSIONS.branchesRead]);
  if (!auth.ok) return auth.response;

  const canCrossBranch = hasPermission(auth.user.permissions, PERMISSIONS.branchesReadAll);
  const where = canCrossBranch ? {} : { id: auth.user.branchId ?? undefined };

  const branches = await prisma.branch.findMany({
    where,
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      address: true,
      phone: true,
      isActive: true,
    },
  });

  return NextResponse.json(branches);
}
