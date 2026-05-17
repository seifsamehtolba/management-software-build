import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import type { AppRole } from "@/lib/appRole";
import {
  hasAnyPermission,
  hasPermission,
  legacyRoleToPermissions,
  normalizePermissions,
  PERMISSIONS,
  type PermissionKey,
} from "@/lib/permissions";

const anySyncPermission: PermissionKey[] = [
  PERMISSIONS.syncPreview,
  PERMISSIONS.syncMutate,
  PERMISSIONS.syncResolve,
  PERMISSIONS.syncForce,
];

function sessionPermissions(input: { permissions?: string[] | null; role?: string | null }) {
  const normalized = normalizePermissions(input.permissions);
  if (normalized.length > 0) return normalized;
  return legacyRoleToPermissions((input.role as AppRole | null) ?? null);
}

export async function requireSyncAccess(requiredPermissions: PermissionKey[] = anySyncPermission) {
  const session = await getServerSession(authOptions);
  const permissions = sessionPermissions({
    permissions: session?.user?.permissions,
    role: session?.user?.role,
  });
  if (!session?.user?.id || !hasAnyPermission(permissions, requiredPermissions)) {
    return {
      ok: false as const,
      response: NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 }),
    };
  }

  return {
    ok: true as const,
    user: {
      id: session.user.id,
      role: session.user.role,
      permissions,
      branchId: session.user.branchId ?? null,
    },
  };
}

export function ensureBranchSyncAccess(params: {
  permissions: string[];
  userBranchId: string | null;
  payload?: Record<string, unknown>;
}) {
  const { permissions, userBranchId, payload } = params;
  if (hasPermission(permissions, PERMISSIONS.syncCrossBranch)) {
    return { ok: true as const };
  }

  const payloadBranchId = (payload?.branchId as string | undefined) ?? null;
  if (!payloadBranchId || !userBranchId) {
    return { ok: true as const };
  }

  if (payloadBranchId !== userBranchId) {
    return {
      ok: false as const,
      response: NextResponse.json({ status: "error", message: "Branch access denied" }, { status: 403 }),
    };
  }

  return { ok: true as const };
}
