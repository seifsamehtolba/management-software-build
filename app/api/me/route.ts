import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { legacyRoleToPermissions, normalizePermissions } from "@/lib/permissions";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      permissions: true,
      branchId: true,
      createdAt: true,
      branch: { select: { id: true, name: true } },
    },
  });

  if (!user) {
    return NextResponse.json({ message: "User not found" }, { status: 404 });
  }

  return NextResponse.json({
    ...user,
    permissions:
      normalizePermissions(user.permissions as string[]).length > 0
        ? normalizePermissions(user.permissions as string[])
        : legacyRoleToPermissions(user.role),
    createdAt: user.createdAt.toISOString(),
  });
}
