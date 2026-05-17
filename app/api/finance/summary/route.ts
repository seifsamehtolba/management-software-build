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
  const analytics = await getFinanceAnalytics(effectiveBranchId, 6);
  const current = analytics.overview.currentMonth;
  const trailing = analytics.overview.trailing;

  return NextResponse.json({
    branchId: effectiveBranchId,
    revenue: current.revenue,
    expense: current.expenses,
    purchaseCost: current.cogs,
    purchasePaid: current.supplierPaid,
    grossEstimate: current.grossProfit,
    netEstimate: current.netProfit,
    currentMonth: current,
    trailing,
    dataQuality: {
      estimatedCostFallbackCount: analytics.meta.estimatedCostFallbackCount,
    },
  });
}
