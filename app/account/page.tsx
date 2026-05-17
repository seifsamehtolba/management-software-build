import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppPage, Card, PageHeader } from "@/components/ui/primitives";
import { Mail, Building2, Shield, Calendar } from "lucide-react";
import { describePermissionCount, hasPermission, legacyRoleToPermissions, normalizePermissions, PERMISSIONS } from "@/lib/permissions";

function formatAccessSummary(count: number) {
  return describePermissionCount(count);
}

export default async function AccountPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/login");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      name: true,
      email: true,
      role: true,
      permissions: true,
      createdAt: true,
      branch: { select: { name: true, address: true, phone: true } },
    },
  });

  if (!user) {
    redirect("/login");
  }

  const permissions =
    normalizePermissions(user.permissions as string[]).length > 0
      ? normalizePermissions(user.permissions as string[])
      : legacyRoleToPermissions(user.role);
  const canOpenSettings = hasPermission(permissions, PERMISSIONS.settingsStoreRead);

  return (
    <AppPage>
      <PageHeader
        title="الملف الشخصي / Account"
        subtitle="بيانات تسجيل الدخول والوصول الخاصة بحسابك."
        actions={
          canOpenSettings ? (
            <Link href="/settings" className="app-btn app-btn-secondary text-sm">
              الإعدادات / Settings
            </Link>
          ) : undefined
        }
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-base font-semibold">Identity</h2>
          <dl className="space-y-3 text-sm">
            <div className="flex gap-3">
              <dt className="flex shrink-0 items-center gap-1.5 text-[var(--muted)]">
                <Shield size={14} aria-hidden />
                Access
              </dt>
              <dd className="font-medium">{formatAccessSummary(permissions.length)}</dd>
            </div>
            <div className="flex gap-3">
              <dt className="flex shrink-0 items-center gap-1.5 text-[var(--muted)]">
                <Mail size={14} aria-hidden />
                Email
              </dt>
              <dd className="break-all font-medium">{user.email}</dd>
            </div>
            <div className="flex gap-3">
              <dt className="flex shrink-0 items-center gap-1.5 text-[var(--muted)]">
                <Calendar size={14} aria-hidden />
                Member since
              </dt>
              <dd className="font-medium">{user.createdAt.toLocaleDateString()}</dd>
            </div>
          </dl>
        </Card>

        <Card>
          <h2 className="mb-3 text-base font-semibold">Branch</h2>
          {user.branch ? (
            <dl className="space-y-2 text-sm">
              <div className="flex gap-3">
                <dt className="flex shrink-0 items-center gap-1.5 text-[var(--muted)]">
                  <Building2 size={14} aria-hidden />
                  Location
                </dt>
                <dd className="font-medium">{user.branch.name}</dd>
              </div>
              {user.branch.address ? (
                <p className="text-[var(--muted)]">{user.branch.address}</p>
              ) : null}
              {user.branch.phone ? (
                <p className="text-[var(--muted)]">{user.branch.phone}</p>
              ) : null}
            </dl>
          ) : (
            <p className="text-sm text-[var(--muted)]">
              You are not assigned to a specific branch. Owners and some roles can work across all locations.
            </p>
          )}
        </Card>
      </div>
    </AppPage>
  );
}
