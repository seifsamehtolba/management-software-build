import { NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const auth = await requireApiAnyPermission([
    PERMISSIONS.reportsFinanceRead,
    PERMISSIONS.reportsDashboardRead,
  ]);
  if (!auth.ok) return auth.response;

  const now = new Date();
  const thirtyDaysAgo = new Date(now); thirtyDaysAgo.setDate(now.getDate() - 30);
  const sixtyDaysAgo  = new Date(now); sixtyDaysAgo.setDate(now.getDate() - 60);
  const ninetyDaysAgo = new Date(now); ninetyDaysAgo.setDate(now.getDate() - 90);

  const [
    salesLast30,
    saleItemsLast30,
    allSaleItems,
    allStockLevels,
    allProducts,
    customerSales,
    openRepairs,
    buildsByTech,
    repairsByTech,
    closedShifts,
  ] = await Promise.all([
    prisma.sale.findMany({
      where: { status: "COMPLETED", createdAt: { gte: thirtyDaysAgo } },
      select: { total: true, createdAt: true },
    }),
    prisma.saleItem.findMany({
      where: { sale: { status: "COMPLETED", createdAt: { gte: thirtyDaysAgo } } },
      select: {
        productId: true, quantity: true, total: true,
        product: { select: { costPrice: true, name: true, sku: true, category: { select: { name: true } } } },
      },
    }),
    prisma.saleItem.findMany({
      where: { sale: { status: "COMPLETED" } },
      select: { productId: true, quantity: true, total: true, sale: { select: { createdAt: true } } },
    }),
    prisma.stockLevel.findMany({
      select: { productId: true, quantity: true, product: { select: { costPrice: true } } },
    }),
    prisma.product.findMany({
      where: { isActive: true },
      select: { id: true, name: true, sku: true, costPrice: true },
    }),
    prisma.sale.findMany({
      where: { status: "COMPLETED", customerId: { not: null } },
      select: { customerId: true, total: true, createdAt: true, customer: { select: { name: true, phone: true } } },
    }),
    prisma.repairTicket.findMany({
      where: { status: { notIn: ["DELIVERED", "CANCELLED"] } },
      select: { createdAt: true },
    }),
    prisma.buildOrder.groupBy({
      by: ["technicianId"],
      where: { status: "DELIVERED", technicianId: { not: null } },
      _count: { id: true },
    }),
    prisma.repairTicket.groupBy({
      by: ["technicianId"],
      where: { status: "DELIVERED", technicianId: { not: null } },
      _count: { id: true },
    }),
    prisma.cashShift.findMany({
      where: { status: "CLOSED" },
      orderBy: { closedAt: "desc" },
      take: 14,
      select: { openedAt: true, closedAt: true, expectedCash: true, countedCash: true, variance: true, user: { select: { name: true } } },
    }),
  ]);

  // --- Sales trend (30 days) ---
  const trendMap = new Map<string, { revenue: number; count: number }>();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now); d.setDate(now.getDate() - i);
    trendMap.set(d.toISOString().slice(0, 10), { revenue: 0, count: 0 });
  }
  for (const s of salesLast30) {
    const key = s.createdAt.toISOString().slice(0, 10);
    if (trendMap.has(key)) {
      const e = trendMap.get(key)!;
      e.revenue += Number(s.total); e.count += 1;
    }
  }
  const trend = [...trendMap.entries()].map(([date, v]) => ({ date, ...v }));

  // --- Top products (last 30 days) ---
  const prodMap = new Map<string, { name: string; sku: string; category: string; revenue: number; qty: number; cost: number }>();
  for (const item of saleItemsLast30) {
    const e = prodMap.get(item.productId) ?? { name: item.product.name, sku: item.product.sku, category: item.product.category.name, revenue: 0, qty: 0, cost: 0 };
    e.revenue += Number(item.total); e.qty += item.quantity; e.cost += Number(item.product.costPrice) * item.quantity;
    prodMap.set(item.productId, e);
  }
  const topProducts = [...prodMap.entries()]
    .map(([id, v]) => ({ id, ...v, margin: v.revenue - v.cost, marginPct: v.revenue > 0 ? ((v.revenue - v.cost) / v.revenue) * 100 : 0 }))
    .sort((a, b) => b.revenue - a.revenue).slice(0, 10);

  // --- Sales by category (last 30 days) ---
  const catMap = new Map<string, { revenue: number; qty: number }>();
  for (const item of saleItemsLast30) {
    const cat = item.product.category.name;
    const e = catMap.get(cat) ?? { revenue: 0, qty: 0 };
    e.revenue += Number(item.total); e.qty += item.quantity;
    catMap.set(cat, e);
  }
  const byCategory = [...catMap.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.revenue - a.revenue).slice(0, 10);

  // --- Margin summary (last 30 days) ---
  let totalRevenue = 0, totalCost = 0;
  for (const item of saleItemsLast30) { totalRevenue += Number(item.total); totalCost += Number(item.product.costPrice) * item.quantity; }
  const grossMargin = totalRevenue - totalCost;
  const grossMarginPct = totalRevenue > 0 ? (grossMargin / totalRevenue) * 100 : 0;

  // --- Inventory valuation ---
  const stockByProduct = new Map<string, number>();
  for (const sl of allStockLevels) stockByProduct.set(sl.productId, (stockByProduct.get(sl.productId) ?? 0) + Math.max(0, sl.quantity));
  let inventoryValue = 0;
  for (const sl of allStockLevels) inventoryValue += Number(sl.product.costPrice) * Math.max(0, sl.quantity);
  const totalSkus = new Set(allStockLevels.map((sl) => sl.productId)).size;

  // --- Dead stock ---
  const lastSoldMap = new Map<string, Date>();
  for (const item of allSaleItems) {
    const e = lastSoldMap.get(item.productId);
    if (!e || item.sale.createdAt > e) lastSoldMap.set(item.productId, item.sale.createdAt);
  }
  const deadStock = allProducts
    .filter((p) => { const q = stockByProduct.get(p.id) ?? 0; if (q <= 0) return false; const ls = lastSoldMap.get(p.id); return !ls || ls < sixtyDaysAgo; })
    .map((p) => { const q = stockByProduct.get(p.id) ?? 0; return { id: p.id, name: p.name, sku: p.sku, onHand: q, costPrice: Number(p.costPrice), totalValue: q * Number(p.costPrice), lastSoldAt: lastSoldMap.get(p.id)?.toISOString() ?? null }; })
    .sort((a, b) => b.totalValue - a.totalValue).slice(0, 20);

  // --- ABC analysis ---
  const allTimeRevMap = new Map<string, number>();
  for (const item of allSaleItems) allTimeRevMap.set(item.productId, (allTimeRevMap.get(item.productId) ?? 0) + Number(item.total));
  const sortedRevs = [...allTimeRevMap.values()].sort((a, b) => b - a);
  const totalAllTime = sortedRevs.reduce((s, v) => s + v, 0);
  let cum = 0, abcA = 0, abcB = 0, abcC = 0;
  for (const rev of sortedRevs) { cum += rev; const pct = totalAllTime > 0 ? (cum / totalAllTime) * 100 : 0; if (pct <= 80) abcA++; else if (pct <= 95) abcB++; else abcC++; }

  // --- Customer LTV ---
  const custMap = new Map<string, { name: string; phone: string; totalSpent: number; orderCount: number; lastOrderAt: string }>();
  for (const s of customerSales) {
    if (!s.customerId || !s.customer) continue;
    const e = custMap.get(s.customerId) ?? { name: s.customer.name, phone: s.customer.phone, totalSpent: 0, orderCount: 0, lastOrderAt: s.createdAt.toISOString() };
    e.totalSpent += Number(s.total); e.orderCount += 1;
    if (s.createdAt.toISOString() > e.lastOrderAt) e.lastOrderAt = s.createdAt.toISOString();
    custMap.set(s.customerId, e);
  }
  const topCustomers = [...custMap.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.totalSpent - a.totalSpent).slice(0, 10);
  let repeatCount = 0, oneTimeCount = 0;
  for (const v of custMap.values()) { if (v.orderCount > 1) repeatCount++; else oneTimeCount++; }
  const lapsedCustomers = [...custMap.entries()]
    .filter(([, v]) => new Date(v.lastOrderAt) < ninetyDaysAgo)
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => new Date(b.lastOrderAt).getTime() - new Date(a.lastOrderAt).getTime())
    .slice(0, 20);

  // --- Technician performance ---
  const techIds = [...new Set([...buildsByTech.map((b) => b.technicianId!), ...repairsByTech.map((r) => r.technicianId!)])];
  const techUsers = techIds.length > 0 ? await prisma.user.findMany({ where: { id: { in: techIds } }, select: { id: true, name: true } }) : [];
  const techNameMap = new Map(techUsers.map((u) => [u.id, u.name]));
  const techPerf = techIds.map((id) => ({
    id, name: techNameMap.get(id) ?? id,
    buildsCompleted: buildsByTech.find((b) => b.technicianId === id)?._count.id ?? 0,
    repairsCompleted: repairsByTech.find((r) => r.technicianId === id)?._count.id ?? 0,
  })).sort((a, b) => (b.buildsCompleted + b.repairsCompleted) - (a.buildsCompleted + a.repairsCompleted));

  // --- Repair aging ---
  const repairAging = {
    open: openRepairs.length,
    over7days: openRepairs.filter((r) => now.getTime() - r.createdAt.getTime() > 7 * 86400000).length,
    over14days: openRepairs.filter((r) => now.getTime() - r.createdAt.getTime() > 14 * 86400000).length,
    oldestDays: openRepairs.length > 0 ? Math.floor((now.getTime() - Math.min(...openRepairs.map((r) => r.createdAt.getTime()))) / 86400000) : 0,
  };

  // --- Shift variances ---
  const shiftVariances = closedShifts.map((s) => ({
    openedAt: s.openedAt.toISOString(),
    closedAt: s.closedAt?.toISOString() ?? null,
    expectedCash: Number(s.expectedCash),
    countedCash: Number(s.countedCash ?? 0),
    variance: Number(s.variance),
    staffName: s.user.name,
  }));

  return NextResponse.json({
    sales: { trend, topProducts, byCategory, marginSummary: { totalRevenue, totalCost, grossMargin, grossMarginPct } },
    inventory: { totalValue: inventoryValue, totalSkus, deadStock, abcA, abcB, abcC },
    customers: { topCustomers, repeatCount, oneTimeCount, lapsedCustomers },
    operations: { techPerf, repairAging, shiftVariances },
  });
}
