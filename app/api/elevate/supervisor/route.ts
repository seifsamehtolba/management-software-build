import { NextResponse } from "next/server";
import { compare } from "bcryptjs";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { APPROVER_PERMISSIONS, DEFAULT_ELEVATION_GRANTS, signElevationToken } from "@/lib/elevationToken";
import { hasAnyPermission, legacyRoleToPermissions, normalizePermissions } from "@/lib/permissions";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as { supervisorEmail?: string; supervisorPassword?: string };
  const email = body.supervisorEmail?.trim().toLowerCase();
  const password = body.supervisorPassword ?? "";
  if (!email || !password) {
    return NextResponse.json({ message: "Supervisor email and password required" }, { status: 400 });
  }

  const supervisor = await prisma.user.findUnique({ where: { email } });
  const supervisorPermissions = supervisor
    ? (normalizePermissions(supervisor.permissions as string[]).length > 0
        ? normalizePermissions(supervisor.permissions as string[])
        : legacyRoleToPermissions(supervisor.role))
    : [];
  if (!supervisor?.isActive || !hasAnyPermission(supervisorPermissions, APPROVER_PERMISSIONS)) {
    return NextResponse.json({ message: "Invalid supervisor account" }, { status: 401 });
  }

  const ok = await compare(password, supervisor.passwordHash);
  if (!ok) {
    return NextResponse.json({ message: "Invalid supervisor password" }, { status: 401 });
  }

  const token = signElevationToken({
    sub: session.user.id,
    grants: [...DEFAULT_ELEVATION_GRANTS],
    exp: Math.floor(Date.now() / 1000) + 5 * 60,
  });

  return NextResponse.json({
    elevationToken: token,
    expiresInSeconds: 300,
  });
}
