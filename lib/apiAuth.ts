import { getServerSession } from "next-auth";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { verifyElevationToken } from "@/lib/elevationToken";
import type { AppRole } from "@/lib/appRole";
import {
  hasAllPermissions,
  hasAnyPermission,
  legacyRoleToPermissions,
  normalizePermissions,
  type PermissionKey,
} from "@/lib/permissions";

export type { AppRole } from "@/lib/appRole";
export type { PermissionKey } from "@/lib/permissions";

type PermissionMode = "all" | "any";

function effectivePermissions(input: { permissions?: string[] | null; role?: AppRole | null }): PermissionKey[] {
  const normalized = normalizePermissions(input.permissions);
  if (normalized.length > 0) {
    return normalized;
  }
  return legacyRoleToPermissions(input.role ?? null);
}

function permissionCheck(
  mode: PermissionMode,
  permissions: readonly PermissionKey[],
  required: readonly PermissionKey[],
) {
  if (required.length === 0) return true;
  return mode === "all"
    ? hasAllPermissions(permissions, required)
    : hasAnyPermission(permissions, required);
}

async function requireApiPermissionSet(requiredPermissions: PermissionKey[], mode: PermissionMode) {
  const session = await getServerSession(authOptions);
  const userRole = session?.user?.role as AppRole | undefined;
  const userPermissions = effectivePermissions({
    permissions: session?.user?.permissions,
    role: userRole,
  });

  if (!session?.user?.id) {
    return {
      ok: false as const,
      response: NextResponse.json({ message: "Unauthorized" }, { status: 401 }),
    };
  }

  if (permissionCheck(mode, userPermissions, requiredPermissions)) {
    return {
      ok: true as const,
      elevation: false as const,
      user: {
        id: session.user.id,
        role: userRole ?? "CASHIER",
        permissions: userPermissions,
        branchId: session.user.branchId ?? null,
      },
    };
  }

  const h = await headers();
  const elevHeader = h.get("x-elevation-token");
  if (elevHeader) {
    const v = verifyElevationToken(elevHeader);
    if (
      v.ok &&
      v.payload.sub === session.user.id &&
      permissionCheck(mode, v.payload.grants, requiredPermissions)
    ) {
      return {
        ok: true as const,
        elevation: true as const,
        user: {
          id: session.user.id,
          role: userRole ?? "CASHIER",
          permissions: userPermissions,
          branchId: session.user.branchId ?? null,
        },
      };
    }
  }

  return {
    ok: false as const,
    response: NextResponse.json(
      {
        message: "Forbidden",
        code: "ELEVATION_REQUIRED",
        requiredPermissions,
      },
      { status: 403 },
    ),
  };
}

export async function requireApiPermissions(requiredPermissions: PermissionKey[]) {
  return requireApiPermissionSet(requiredPermissions, "all");
}

export async function requireApiAnyPermission(requiredPermissions: PermissionKey[]) {
  return requireApiPermissionSet(requiredPermissions, "any");
}

/** Session present but role check skipped — use for routes that handle their own auth */
export async function requireSession() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return {
      ok: false as const,
      response: NextResponse.json({ message: "Unauthorized" }, { status: 401 }),
    };
  }
  return {
    ok: true as const,
    user: {
      id: session.user.id,
      role: session.user.role as AppRole,
      permissions: effectivePermissions({
        permissions: session.user.permissions,
        role: session.user.role as AppRole,
      }),
      branchId: session.user.branchId ?? null,
    },
  };
}
