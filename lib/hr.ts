import { hasPermission, PERMISSIONS } from "@/lib/permissions";

export type BranchScopedAuth = {
  permissions: string[];
  branchId: string | null;
};

export function canAccessPayrollBranch(auth: BranchScopedAuth, targetBranchId: string | null | undefined) {
  return (
    hasPermission(auth.permissions, PERMISSIONS.payrollCrossBranch) ||
    !targetBranchId ||
    auth.branchId === targetBranchId
  );
}

export function resolvePayrollBranch(auth: BranchScopedAuth, requestedBranchId?: string | null) {
  return hasPermission(auth.permissions, PERMISSIONS.payrollCrossBranch) ? requestedBranchId ?? null : auth.branchId;
}

export function latestCompensation<T extends { effectiveFrom: Date; createdAt?: Date }>(rows: T[]) {
  return [...rows].sort((a, b) => {
    const effectiveDelta = b.effectiveFrom.getTime() - a.effectiveFrom.getTime();
    if (effectiveDelta !== 0) return effectiveDelta;
    return (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0);
  })[0] ?? null;
}
