import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiAnyPermission, requireApiPermissions } from "@/lib/apiAuth";
import {
  hasPermission,
  isPermissionKey,
  legacyRoleToPermissions,
  normalizePermissions,
  PERMISSIONS,
} from "@/lib/permissions";

const permissionSchema = z.array(z.string().trim().refine(isPermissionKey, "Invalid permission")).max(64);

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(120),
  password: z.string().min(8).max(200),
  permissions: permissionSchema.default([]),
  branchId: z.string().cuid().optional().nullable(),
});

export async function GET() {
  const auth = await requireApiAnyPermission([PERMISSIONS.usersRead]);
  if (!auth.ok) return auth.response;
  const canCrossBranch = hasPermission(auth.user.permissions, PERMISSIONS.payrollCrossBranch);

  const users = await prisma.user.findMany({
    where: canCrossBranch ? undefined : { branchId: auth.user.branchId ?? undefined },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      permissions: true,
      branchId: true,
      isActive: true,
      createdAt: true,
      branch: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({
    users: users.map((user) => ({
      ...user,
      permissions:
        normalizePermissions(user.permissions as string[]).length > 0
          ? normalizePermissions(user.permissions as string[])
          : legacyRoleToPermissions(user.role),
    })),
  });
}

/** Owner-only: create staff accounts */
export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ message: parsed.error.message }, { status: 400 });
  }

  const body = parsed.data;
  const auth = await requireApiPermissions([PERMISSIONS.usersCreate, PERMISSIONS.usersPermissionsManage]);
  if (!auth.ok) return auth.response;
  const canCrossBranch = hasPermission(auth.user.permissions, PERMISSIONS.payrollCrossBranch);
  const targetBranchId = canCrossBranch ? body.branchId ?? null : auth.user.branchId;

  if (!canCrossBranch && !targetBranchId) {
    return NextResponse.json({ message: "Branch-scoped managers must belong to a branch" }, { status: 400 });
  }

  if (!canCrossBranch && body.branchId && body.branchId !== auth.user.branchId) {
    return NextResponse.json({ message: "You can only create staff in your own branch" }, { status: 403 });
  }

  if (targetBranchId) {
    const br = await prisma.branch.findUnique({ where: { id: targetBranchId } });
    if (!br) return NextResponse.json({ message: "Invalid branch" }, { status: 400 });
  }

  const exists = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
  if (exists) {
    return NextResponse.json({ message: "Email already in use" }, { status: 409 });
  }

  const passwordHash = await hash(body.password, 12);
  const user = await prisma.user.create({
    data: {
      name: body.name,
      email: body.email.toLowerCase(),
      passwordHash,
      branchId: targetBranchId ?? null,
      permissions: normalizePermissions(body.permissions),
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      permissions: true,
      branchId: true,
      isActive: true,
      createdAt: true,
    },
  });

  return NextResponse.json(
    {
      user: {
        ...user,
        permissions:
          normalizePermissions(user.permissions as string[]).length > 0
            ? normalizePermissions(user.permissions as string[])
            : legacyRoleToPermissions(user.role),
      },
    },
    { status: 201 },
  );
}
