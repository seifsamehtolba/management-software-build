import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import type { AppRole } from "@/lib/appRole";
import { hasPermission, legacyRoleToPermissions, normalizePermissions, PERMISSIONS } from "@/lib/permissions";

const PREFIX_PERMISSIONS = [
  { prefix: "/settings", permission: PERMISSIONS.settingsStoreRead },
  { prefix: "/reports", permission: PERMISSIONS.reportsDashboardRead },
  { prefix: "/finance", permission: PERMISSIONS.reportsFinanceRead },
  { prefix: "/payables", permission: PERMISSIONS.financePayablesRead },
  { prefix: "/users", permission: PERMISSIONS.usersRead },
  { prefix: "/hr", permission: PERMISSIONS.hrRead },
  { prefix: "/audit", permission: PERMISSIONS.auditRead },
] as const;

export default withAuth(
  function proxy(req) {
    const role = req.nextauth.token?.role as AppRole | undefined;
    const permissions =
      normalizePermissions(req.nextauth.token?.permissions as string[] | undefined).length > 0
        ? normalizePermissions(req.nextauth.token?.permissions as string[] | undefined)
        : legacyRoleToPermissions(role ?? null);
    const pathname = req.nextUrl.pathname;
    const matchedPrefix = PREFIX_PERMISSIONS.find((entry) => pathname.startsWith(entry.prefix));

    if (matchedPrefix && !hasPermission(permissions, matchedPrefix.permission)) {
      return NextResponse.redirect(new URL("/", req.url));
    }

    return NextResponse.next();
  },
  {
    pages: { signIn: "/login" },
    callbacks: {
      authorized: ({ token, req }) => {
        const p = req.nextUrl.pathname;
        if (p === "/login" || p.startsWith("/login/")) return true;
        return !!token;
      },
    },
  },
);

/**
 * Page routes only: APIs enforce auth in route handlers; skip Next internals & static assets.
 */
export const config = {
  matcher: [
    "/((?!api|_next|favicon.ico|sw.js|manifest.json|icons|.*\\..*).*)",
  ],
};
