import { NextRequest, NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { getFinanceAnalytics } from "@/lib/financeAnalytics";
import { PERMISSIONS } from "@/lib/permissions";
import { branchScope } from "@/lib/quotes";

export async function GET(req: NextRequest) {
  const auth = await requireApiAnyPermission([PERMISSIONS.reportsFinanceRead]);
  if (!auth.ok) return auth.response;

  const requestedBranchId = req.nextUrl.searchParams.get("branchId")?.trim() ?? "";
  const effectiveBranchId = branchScope(auth.user, requestedBranchId, PERMISSIONS.reportsFinanceCrossBranch);
  const monthsParam = Number(req.nextUrl.searchParams.get("months") ?? "12");
  const months = Number.isFinite(monthsParam) ? Math.min(24, Math.max(3, Math.floor(monthsParam))) : 12;

  const analytics = await getFinanceAnalytics(effectiveBranchId, months);
  return NextResponse.json(analytics);
}
