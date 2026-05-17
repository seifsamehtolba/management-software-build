import { prisma } from "@/lib/prisma";
import { getStoreSettings } from "@/lib/storeSettings";
import { DashboardHomeClient } from "@/components/DashboardHomeClient";

export default async function Home() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const salesTrendSince = new Date();
  salesTrendSince.setDate(salesTrendSince.getDate() - 13);
  salesTrendSince.setHours(0, 0, 0, 0);
  const paymentMixSince = new Date();
  paymentMixSince.setDate(paymentMixSince.getDate() - 30);
  paymentMixSince.setHours(0, 0, 0, 0);

  const [
    salesTodayAgg,
    salesTodayCount,
    openRepairsCount,
    lowStockLevels,
    activeProductsCount,
    recentSales,
    recentRepairs,
    storeSettings,
    profitWindow,
    salesTrendWindow,
    paymentMixWindow,
    quoteStatusWindow,
    branches,
  ] = await Promise.all([
    prisma.sale.aggregate({
      _sum: { total: true },
      where: { createdAt: { gte: startOfToday }, status: "COMPLETED" },
    }),
    prisma.sale.count({
      where: { createdAt: { gte: startOfToday }, status: "COMPLETED" },
    }),
    prisma.repairTicket.count({
      where: { status: { in: ["RECEIVED", "DIAGNOSING", "WAITING_PARTS", "IN_REPAIR", "READY"] } },
    }),
    prisma.stockLevel.findMany({
      select: {
        id: true,
        quantity: true,
        location: { select: { name: true } },
        product: { select: { name: true, reorderPoint: true } },
      },
    }),
    prisma.product.count({
      where: { isActive: true },
    }),
    prisma.sale.findMany({
      where: { status: "COMPLETED" },
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
      include: {
        customer: { select: { name: true } },
      },
    }),
    getStoreSettings(),
    prisma.saleItem.findMany({
      where: {
        sale: {
          status: "COMPLETED",
        },
      },
      select: {
        total: true,
        quantity: true,
        realizedCogs: true,
        sale: {
          select: {
            cashier: {
              select: {
                branch: { select: { name: true } },
              },
            },
          },
        },
        product: {
          select: {
            costPrice: true,
            category: { select: { name: true } },
          },
        },
      },
      take: 500,
      orderBy: { sale: { createdAt: "desc" } },
    }),
    prisma.sale.findMany({
      where: {
        status: "COMPLETED",
        createdAt: { gte: salesTrendSince },
      },
      select: {
        createdAt: true,
        total: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.payment.findMany({
      where: {
        sale: {
          status: "COMPLETED",
          createdAt: { gte: paymentMixSince },
        },
      },
      select: {
        method: true,
        amount: true,
      },
    }),
    prisma.quote.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.branch.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
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
  const grossMarginWindow = revenueWindow > 0 ? Number((((revenueWindow - cogsWindow) / revenueWindow) * 100).toFixed(2)) : 0;
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
  for (let i = 13; i >= 0; i -= 1) {
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
    .map(([method, amount]) => ({
      method,
      amount: Number(amount.toFixed(2)),
    }))
    .sort((a, b) => b.amount - a.amount);

  const quoteStatuses = ["DRAFT", "SENT", "APPROVED", "REJECTED", "EXPIRED", "CONVERTED"];
  const quoteMap = new Map<string, number>(quoteStatuses.map((status) => [status, 0]));
  for (const row of quoteStatusWindow) {
    quoteMap.set(row.status, row._count._all);
  }
  const quoteFunnel = quoteStatuses.map((status) => ({
    status,
    count: quoteMap.get(status) ?? 0,
  }));

  return (
    <DashboardHomeClient
      data={{
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
      }}
      defaults={storeSettings.dashboardDefaults}
      branches={branches}
      deltas={{
        salesTodayPct: 0,
        revenuePct: 0,
        grossProfitPct: 0,
        openRepairsDiff: 0,
        lowStockDiff: 0,
      }}
    />
  );
}
