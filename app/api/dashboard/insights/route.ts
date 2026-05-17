import { NextRequest, NextResponse } from "next/server";
import { QuoteStatus } from "@prisma/client";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

type MetricPack = {
  salesToday: number;
  salesTodayCount: number;
  openRepairsCount: number;
  lowStockCount: number;
  activeProductsCount: number;
  recentSales: Array<{
    id: string;
    invoiceNumber: string;
    total: number;
    customerName: string | null;
    cashierName: string;
    createdAt: string;
  }>;
  recentRepairs: Array<{
    id: string;
    ticketNumber: string;
    status: string;
    customerName: string;
    deviceName: string;
    createdAt: string;
  }>;
  profitSummary: {
    revenue: number;
    cogs: number;
    grossProfit: number;
    grossMarginPct: number;
    topCategory: { name: string; profit: number } | null;
    topBranch: { name: string; profit: number } | null;
  };
  charts: {
    salesTrend: Array<{ date: string; sales: number; orders: number }>;
    paymentMix: Array<{ method: string; amount: number }>;
    quoteFunnel: Array<{ status: string; count: number }>;
    lowStockItems: Array<{
      id: string;
      productName: string;
      locationName: string;
      qty: number;
      reorderPoint: number;
    }>;
  };
};

async function buildMetrics(branchId: string | null, days: number): Promise<MetricPack> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const trendSince = new Date();
  trendSince.setDate(trendSince.getDate() - (days - 1));
  trendSince.setHours(0, 0, 0, 0);

  const saleWhere = {
    status: "COMPLETED" as const,
    ...(branchId ? { cashier: { branchId } } : {}),
  };

  const [
    salesTodayAgg,
    salesTodayCount,
    openRepairsCount,
    lowStockLevels,
    activeProductsCount,
    recentSales,
    recentRepairs,
    profitWindow,
    salesTrendWindow,
    paymentMixWindow,
    quoteStatusWindow,
  ] = await Promise.all([
    prisma.sale.aggregate({
      _sum: { total: true },
      where: { ...saleWhere, createdAt: { gte: startOfToday } },
    }),
    prisma.sale.count({
      where: { ...saleWhere, createdAt: { gte: startOfToday } },
    }),
    prisma.repairTicket.count({
      where: { status: { in: ["RECEIVED", "DIAGNOSING", "WAITING_PARTS", "IN_REPAIR", "READY"] } },
    }),
    prisma.stockLevel.findMany({
      where: branchId ? { location: { branchId } } : undefined,
      select: {
        id: true,
        quantity: true,
        location: { select: { name: true } },
        product: { select: { name: true, reorderPoint: true } },
      },
    }),
    prisma.product.count({ where: { isActive: true } }),
    prisma.sale.findMany({
      where: saleWhere,
      orderBy: { createdAt: "desc" },
      take: 8,
      include: {
        customer: { select: { name: true } },
        cashier: { select: { name: true } },
      },
    }),
    prisma.repairTicket.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
      include: { customer: { select: { name: true } } },
    }),
    prisma.saleItem.findMany({
      where: {
        sale: {
          status: "COMPLETED",
          createdAt: { gte: trendSince },
          ...(branchId ? { cashier: { branchId } } : {}),
        },
      },
      select: {
        total: true,
        quantity: true,
        realizedCogs: true,
        sale: { select: { cashier: { select: { branch: { select: { name: true } } } } } },
        product: {
          select: {
            costPrice: true,
            category: { select: { name: true } },
          },
        },
      },
      orderBy: { sale: { createdAt: "desc" } },
      take: 1000,
    }),
    prisma.sale.findMany({
      where: { ...saleWhere, createdAt: { gte: trendSince } },
      select: { createdAt: true, total: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.payment.findMany({
      where: {
        sale: {
          ...saleWhere,
          createdAt: { gte: trendSince },
        },
      },
      select: { method: true, amount: true },
    }),
    prisma.quote.groupBy({
      by: ["status"],
      _count: { _all: true },
      where: branchId ? { branchId } : undefined,
    }),
  ]);

  const salesToday = Number(salesTodayAgg._sum.total ?? 0);
  const lowStockCount = lowStockLevels.filter((level) => level.quantity <= level.product.reorderPoint).length;
  let revenueWindow = 0;
  let cogsWindow = 0;
  const byCategory = new Map<string, number>();
  const byBranch = new Map<string, number>();
  for (const item of profitWindow) {
    const lineRevenue = Number(item.total);
    const lineCost = item.realizedCogs === null ? Number(item.product.costPrice) * item.quantity : Number(item.realizedCogs);
    const lineProfit = lineRevenue - lineCost;
    revenueWindow += lineRevenue;
    cogsWindow += lineCost;
    byCategory.set(item.product.category.name, (byCategory.get(item.product.category.name) ?? 0) + lineProfit);
    const branchName = item.sale.cashier.branch?.name ?? "Unassigned";
    byBranch.set(branchName, (byBranch.get(branchName) ?? 0) + lineProfit);
  }
  const grossProfitWindow = Number((revenueWindow - cogsWindow).toFixed(2));
  const grossMarginWindow =
    revenueWindow > 0 ? Number((((revenueWindow - cogsWindow) / revenueWindow) * 100).toFixed(2)) : 0;

  const lowStockItems = lowStockLevels
    .filter((level) => level.quantity <= level.product.reorderPoint)
    .sort((a, b) => a.quantity - b.quantity)
    .slice(0, 6)
    .map((level) => ({
      id: level.id,
      productName: level.product.name,
      locationName: level.location.name,
      qty: level.quantity,
      reorderPoint: level.product.reorderPoint,
    }));

  const salesTrendMap = new Map<string, { sales: number; orders: number }>();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    salesTrendMap.set(key, { sales: 0, orders: 0 });
  }
  for (const sale of salesTrendWindow) {
    const key = sale.createdAt.toISOString().slice(0, 10);
    const bucket = salesTrendMap.get(key);
    if (!bucket) continue;
    bucket.sales += Number(sale.total);
    bucket.orders += 1;
  }
  const salesTrend = Array.from(salesTrendMap.entries()).map(([date, value]) => ({
    date,
    sales: Number(value.sales.toFixed(2)),
    orders: value.orders,
  }));

  const paymentMap = new Map<string, number>();
  for (const row of paymentMixWindow) {
    paymentMap.set(row.method, (paymentMap.get(row.method) ?? 0) + Number(row.amount));
  }
  const paymentMix = Array.from(paymentMap.entries())
    .map(([method, amount]) => ({ method, amount: Number(amount.toFixed(2)) }))
    .sort((a, b) => b.amount - a.amount);

  const quoteStatuses: QuoteStatus[] = ["DRAFT", "SENT", "APPROVED", "REJECTED", "EXPIRED", "CONVERTED"];
  const quoteMap = new Map<QuoteStatus, number>(quoteStatuses.map((status) => [status, 0]));
  for (const row of quoteStatusWindow) {
    quoteMap.set(row.status, row._count._all);
  }
  const quoteFunnel = quoteStatuses.map((status) => ({ status, count: quoteMap.get(status) ?? 0 }));

  return {
    salesToday,
    salesTodayCount,
    openRepairsCount,
    lowStockCount,
    activeProductsCount,
    recentSales: recentSales.map((sale) => ({
      id: sale.id,
      invoiceNumber: sale.invoiceNumber,
      total: Number(sale.total),
      customerName: sale.customer?.name ?? null,
      cashierName: sale.cashier.name,
      createdAt: sale.createdAt.toISOString(),
    })),
    recentRepairs: recentRepairs.map((ticket) => ({
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      status: ticket.status,
      customerName: ticket.customer.name,
      deviceName: ticket.deviceName,
      createdAt: ticket.createdAt.toISOString(),
    })),
    profitSummary: {
      revenue: Number(revenueWindow.toFixed(2)),
      cogs: Number(cogsWindow.toFixed(2)),
      grossProfit: grossProfitWindow,
      grossMarginPct: grossMarginWindow,
      topCategory:
        Array.from(byCategory.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([name, profit]) => ({ name, profit: Number(profit.toFixed(2)) }))[0] ?? null,
      topBranch:
        Array.from(byBranch.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([name, profit]) => ({ name, profit: Number(profit.toFixed(2)) }))[0] ?? null,
    },
    charts: {
      salesTrend,
      paymentMix,
      quoteFunnel,
      lowStockItems,
    },
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireApiAnyPermission([PERMISSIONS.reportsDashboardRead]);
  if (!auth.ok) return auth.response;

  const requestedBranchId = req.nextUrl.searchParams.get("branchId")?.trim() || null;
  const branchId = hasPermission(auth.user.permissions, PERMISSIONS.reportsDashboardCrossBranch)
    ? requestedBranchId
    : auth.user.branchId;
  const daysParam = Number(req.nextUrl.searchParams.get("days") ?? "14");
  const days = Number.isFinite(daysParam) ? Math.min(90, Math.max(7, Math.floor(daysParam))) : 14;

  const current = await buildMetrics(branchId, days);
  const previous = await buildMetrics(branchId, days * 2);

  const prevRevenue = previous.profitSummary.revenue;
  const prevSalesToday = previous.salesToday;
  const prevOpenRepairs = previous.openRepairsCount;
  const prevLowStock = previous.lowStockCount;
  const prevGrossProfit = previous.profitSummary.grossProfit;

  return NextResponse.json({
    days,
    branchId,
    data: current,
    deltas: {
      salesTodayPct: prevSalesToday > 0 ? Number((((current.salesToday - prevSalesToday) / prevSalesToday) * 100).toFixed(1)) : 0,
      revenuePct: prevRevenue > 0 ? Number((((current.profitSummary.revenue - prevRevenue) / prevRevenue) * 100).toFixed(1)) : 0,
      grossProfitPct:
        prevGrossProfit > 0
          ? Number((((current.profitSummary.grossProfit - prevGrossProfit) / prevGrossProfit) * 100).toFixed(1))
          : 0,
      openRepairsDiff: current.openRepairsCount - prevOpenRepairs,
      lowStockDiff: current.lowStockCount - prevLowStock,
    },
  });
}
