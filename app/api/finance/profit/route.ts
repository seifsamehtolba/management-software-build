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
  const daysParam = Number(req.nextUrl.searchParams.get("days") ?? "90");
  const lookbackDays = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(365, Math.floor(daysParam)) : 90;
  const months = Math.max(1, Math.min(24, Math.ceil(lookbackDays / 30)));
  const analytics = await getFinanceAnalytics(effectiveBranchId, months);
  const trailing = analytics.overview.trailing;

  return NextResponse.json({
    windowDays: lookbackDays,
    branchId: effectiveBranchId,
    revenue: trailing.revenue,
    refunds: trailing.refunds,
    cogs: trailing.cogs,
    grossProfit: trailing.grossProfit,
    grossMarginPct: trailing.marginPct,
    byCategory: analytics.breakdowns.byCategory.map((row) => ({
      name: row.name,
      revenue: row.revenue,
      refunds: row.refunds,
      cogs: row.cogs,
      profit: row.grossProfit,
      netProfit: row.netProfit,
      marginPct: row.marginPct,
    })),
    byBranch: analytics.breakdowns.byBranch.map((row) => ({
      name: row.branchName,
      revenue: row.revenue,
      refunds: row.refunds,
      cogs: row.cogs,
      expenses: row.expenses,
      profit: row.grossProfit,
      netProfit: row.netProfit,
      marginPct: row.marginPct,
    })),
    deadStock: {
      count: analytics.operations.deadStock.length,
      products: analytics.operations.deadStock.map((product) => ({
        id: product.productId,
        name: product.productName,
        categoryName: product.categoryName,
        onHand: product.onHand,
        carryingCost: product.carryingCost,
      })),
    },
    lowMarginProducts: analytics.operations.lowMarginProducts,
    dataQuality: analytics.meta,
  });
}
