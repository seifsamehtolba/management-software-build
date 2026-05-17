import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiPermissions } from "@/lib/apiAuth";
import {
  hasPermission,
  isPermissionKey,
  legacyRoleToPermissions,
  normalizePermissions,
  PERMISSIONS,
  type PermissionKey,
} from "@/lib/permissions";

type Params = { params: Promise<{ id: string }> };

const permissionSchema = z.array(z.string().trim().refine(isPermissionKey, "Invalid permission")).max(64);

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  branchId: z.string().cuid().nullable().optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).max(200).optional(),
  permissions: permissionSchema.optional(),
});

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ message: parsed.error.message }, { status: 400 });
  }

  const body = parsed.data;
  const requiredPermissions = new Set<PermissionKey>();
  if (body.name !== undefined || body.branchId !== undefined || body.password !== undefined) {
    requiredPermissions.add(PERMISSIONS.usersUpdate);
  }
  if (body.isActive !== undefined) {
    requiredPermissions.add(PERMISSIONS.usersActivate);
  }
  if (body.permissions !== undefined) {
    requiredPermissions.add(PERMISSIONS.usersPermissionsManage);
  }
  if (requiredPermissions.size === 0) {
    return NextResponse.json({ message: "No changes" }, { status: 400 });
  }

  const auth = await requireApiPermissions(Array.from(requiredPermissions));
  if (!auth.ok) return auth.response;
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ message: "User not found" }, { status: 404 });
  }
  const canCrossBranch = hasPermission(auth.user.permissions, PERMISSIONS.payrollCrossBranch);

  if (!canCrossBranch && existing.branchId && existing.branchId !== auth.user.branchId) {
    return NextResponse.json({ message: "You can only manage staff in your own branch" }, { status: 403 });
  }

  if (!canCrossBranch && body.branchId !== undefined && body.branchId !== auth.user.branchId) {
    return NextResponse.json({ message: "You can only assign staff to your own branch" }, { status: 403 });
  }

  if (body.branchId !== undefined && body.branchId !== null) {
    const br = await prisma.branch.findUnique({ where: { id: body.branchId } });
    if (!br) return NextResponse.json({ message: "Invalid branch" }, { status: 400 });
  }

  const data: {
    name?: string;
    branchId?: string | null;
    isActive?: boolean;
    passwordHash?: string;
    permissions?: string[];
  } = {};

  if (body.name !== undefined) data.name = body.name;
  if (body.branchId !== undefined) data.branchId = body.branchId;
  if (body.isActive !== undefined) data.isActive = body.isActive;
  if (body.password !== undefined) data.passwordHash = await hash(body.password, 12);
  if (body.permissions !== undefined) data.permissions = normalizePermissions(body.permissions);

  const user = await prisma.user.update({
    where: { id },
    data,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      permissions: true,
      branchId: true,
      isActive: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({
    user: {
      ...user,
      permissions:
        normalizePermissions(user.permissions as string[]).length > 0
          ? normalizePermissions(user.permissions as string[])
          : legacyRoleToPermissions(user.role),
    },
  });
}
