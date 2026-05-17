import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

type BranchScoped = { branchId: string | null; branchName: string };
type Severity = "info" | "warning" | "danger";

export type FinanceRecommendation = {
  kind: "margin_down" | "refund_rate_high" | "cashflow_pressure" | "dead_stock" | "low_margin_products";
  severity: Severity;
  value: number;
  benchmark?: number;
};

export type FinanceAnalyticsPayload = {
  meta: {
    branchId: string | null;
    months: number;
    asOf: string;
    estimatedCostFallbackCount: number;
  };
  overview: {
    currentMonth: FinanceMonthMetrics;
    priorMonth: FinanceMonthMetrics | null;
    trailing: FinanceMonthMetrics;
  };
  trend: FinanceMonthMetrics[];
  breakdowns: {
    byBranch: Array<FinanceBreakdownRow & BranchScoped>;
    byCategory: FinanceBreakdownRow[];
    byProduct: Array<FinanceProductRow>;
    paymentMix: Array<{ method: string; amount: number }>;
    refundMethods: Array<{ method: string; amount: number; count: number }>;
    supplierBalances: Array<{ supplierId: string; supplierName: string; outstanding: number }>;
    receivables: Array<{ customerId: string; customerName: string; outstanding: number }>;
  };
  operations: {
    deadStock: Array<{ productId: string; productName: string; categoryName: string; onHand: number; carryingCost: number }>;
    slowMovers: Array<{ productId: string; productName: string; soldQty: number; onHand: number }>;
    lowMarginProducts: Array<FinanceProductRow>;
    payablesOutstanding: number;
    receivablesOutstanding: number;
    payablesAging: { current: number; "1_30": number; "31_60": number; "61_plus": number };
    cashVariance: number;
    exchangeCount: number;
  };
  recommendations: FinanceRecommendation[];
};

export type FinanceMonthMetrics = {
  month: string;
  revenue: number;
  refunds: number;
  cogs: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
  marginPct: number;
  cashIn: number;
  supplierPaid: number;
  netCashflow: number;
};

export type FinanceBreakdownRow = {
  name: string;
  revenue: number;
  refunds: number;
  cogs: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
  marginPct: number;
};

export type FinanceProductRow = {
  productId: string;
  name: string;
  categoryName: string;
  revenue: number;
  refunds: number;
  cogs: number;
  grossProfit: number;
  marginPct: number;
  soldQty: number;
};

type MutableMonthBucket = {
  revenue: number;
  refunds: number;
  cogs: number;
  expenses: number;
  cashIn: number;
  supplierPaid: number;
};

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

function monthKey(date: Date) {
  return date.toISOString().slice(0, 7);
}

function startOfMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function subtractMonths(date: Date, months: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - months, 1));
}

function createMonthBucket(month: string): FinanceMonthMetrics {
  return {
    month,
    revenue: 0,
    refunds: 0,
    cogs: 0,
    grossProfit: 0,
    expenses: 0,
    netProfit: 0,
    marginPct: 0,
    cashIn: 0,
    supplierPaid: 0,
    netCashflow: 0,
  };
}

function finalizeMonth(month: string, bucket: MutableMonthBucket): FinanceMonthMetrics {
  const grossProfit = roundMoney(bucket.revenue - bucket.refunds - bucket.cogs);
  const netProfit = roundMoney(grossProfit - bucket.expenses);
  const netCashflow = roundMoney(bucket.cashIn - bucket.expenses - bucket.supplierPaid);
  const marginBase = bucket.revenue - bucket.refunds;
  return {
    month,
    revenue: roundMoney(bucket.revenue),
    refunds: roundMoney(bucket.refunds),
    cogs: roundMoney(bucket.cogs),
    grossProfit,
    expenses: roundMoney(bucket.expenses),
    netProfit,
    marginPct: marginBase > 0 ? Number(((grossProfit / marginBase) * 100).toFixed(2)) : 0,
    cashIn: roundMoney(bucket.cashIn),
    supplierPaid: roundMoney(bucket.supplierPaid),
    netCashflow,
  };
}

function addToMonthBucket(bucket: MutableMonthBucket, key: keyof MutableMonthBucket, amount: number) {
  bucket[key] = roundMoney(bucket[key] + amount);
}

function ensureBuckets(months: number, asOf: Date) {
  const buckets = new Map<string, MutableMonthBucket>();
  for (let offset = months - 1; offset >= 0; offset -= 1) {
    buckets.set(monthKey(subtractMonths(asOf, offset)), {
      revenue: 0,
      refunds: 0,
      cogs: 0,
      expenses: 0,
      cashIn: 0,
      supplierPaid: 0,
    });
  }
  return buckets;
}

function upsertBreakdown<T extends { revenue: number; refunds: number; cogs: number; expenses: number }>(
  map: Map<string, T>,
  key: string,
  factory: () => T,
) {
  const existing = map.get(key);
  if (existing) return existing;
  const created = factory();
  map.set(key, created);
  return created;
}

function finalizeBreakdown(row: FinanceBreakdownRow): FinanceBreakdownRow {
  const grossProfit = roundMoney(row.revenue - row.refunds - row.cogs);
  const netProfit = roundMoney(grossProfit - row.expenses);
  const base = row.revenue - row.refunds;
  return {
    ...row,
    revenue: roundMoney(row.revenue),
    refunds: roundMoney(row.refunds),
    cogs: roundMoney(row.cogs),
    grossProfit,
    expenses: roundMoney(row.expenses),
    netProfit,
    marginPct: base > 0 ? Number(((grossProfit / base) * 100).toFixed(2)) : 0,
  };
}

export function buildFinanceRecommendations(payload: Pick<FinanceAnalyticsPayload, "overview" | "operations">): FinanceRecommendation[] {
  const current = payload.overview.currentMonth;
  const prior = payload.overview.priorMonth;
  const recommendations: FinanceRecommendation[] = [];
  const refundRate = current.revenue > 0 ? Number((((current.refunds || 0) / current.revenue) * 100).toFixed(2)) : 0;

  if (prior && current.marginPct + 2 < prior.marginPct) {
    recommendations.push({
      kind: "margin_down",
      severity: "warning",
      value: current.marginPct,
      benchmark: prior.marginPct,
    });
  }

  if (refundRate >= 5) {
    recommendations.push({
      kind: "refund_rate_high",
      severity: refundRate >= 8 ? "danger" : "warning",
      value: refundRate,
    });
  }

  if (current.netCashflow < 0) {
    recommendations.push({
      kind: "cashflow_pressure",
      severity: current.netCashflow < 0 ? "danger" : "warning",
      value: current.netCashflow,
    });
  }

  if (payload.operations.deadStock.length > 0) {
    recommendations.push({
      kind: "dead_stock",
      severity: payload.operations.deadStock.length >= 5 ? "warning" : "info",
      value: payload.operations.deadStock.length,
    });
  }

  if (payload.operations.lowMarginProducts.length > 0) {
    recommendations.push({
      kind: "low_margin_products",
      severity: payload.operations.lowMarginProducts.length >= 5 ? "warning" : "info",
      value: payload.operations.lowMarginProducts.length,
    });
  }

  return recommendations.slice(0, 5);
}

export async function getFinanceAnalytics(branchId: string | null, months: number): Promise<FinanceAnalyticsPayload> {
  const asOf = startOfMonth(new Date());
  const rangeStart = subtractMonths(asOf, months - 1);
  const buckets = ensureBuckets(months, asOf);

  const [sales, refunds, expenses, supplierPayments, purchaseOrders, customers, stockLevels, cashShifts] = await Promise.all([
    prisma.sale.findMany({
      where: {
        status: "COMPLETED",
        createdAt: { gte: rangeStart },
        ...(branchId ? { cashier: { branchId } } : {}),
      },
      select: {
        id: true,
        total: true,
        createdAt: true,
        payments: {
          select: {
            method: true,
            amount: true,
            createdAt: true,
          },
        },
        cashier: {
          select: {
            branchId: true,
            branch: { select: { name: true } },
          },
        },
        items: {
          select: {
            id: true,
            quantity: true,
            total: true,
            realizedCogs: true,
            product: {
              select: {
                id: true,
                name: true,
                costPrice: true,
                category: { select: { name: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.refund.findMany({
      where: {
        createdAt: { gte: rangeStart },
        ...(branchId ? { sale: { cashier: { branchId } } } : {}),
      },
      select: {
        id: true,
        amount: true,
        createdAt: true,
        settlementMethod: true,
        refundMode: true,
        items: {
          select: {
            amount: true,
            restockedCost: true,
            product: {
              select: {
                id: true,
                name: true,
                category: { select: { name: true } },
              },
            },
          },
        },
        sale: {
          select: {
            cashier: {
              select: {
                branchId: true,
                branch: { select: { name: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.expense.findMany({
      where: {
        date: { gte: rangeStart },
        ...(branchId ? { user: { branchId } } : {}),
      },
      select: {
        id: true,
        amount: true,
        date: true,
        description: true,
        category: { select: { name: true } },
        user: {
          select: {
            branchId: true,
            branch: { select: { name: true } },
          },
        },
      },
      orderBy: { date: "asc" },
    }),
    prisma.supplierPayment.findMany({
      where: {
        paidAt: { gte: rangeStart },
        po: branchId ? { branchId } : undefined,
      },
      select: {
        amount: true,
        paidAt: true,
        method: true,
        po: {
          select: {
            supplierId: true,
            supplier: { select: { name: true } },
            branchId: true,
            branch: { select: { name: true } },
          },
        },
      },
      orderBy: { paidAt: "asc" },
    }),
    prisma.purchaseOrder.findMany({
      where: {
        status: { not: "CANCELLED" },
        ...(branchId ? { branchId } : {}),
      },
      select: {
        supplierId: true,
        total: true,
        paidAmount: true,
        dueDate: true,
        supplier: { select: { name: true } },
      },
    }),
    prisma.customer.findMany({
      where: {
        creditBalance: { lt: new Prisma.Decimal(0) },
      },
      select: {
        id: true,
        name: true,
        creditBalance: true,
      },
      orderBy: { creditBalance: "asc" },
      take: 10,
    }),
    prisma.stockLevel.findMany({
      where: branchId ? { location: { branchId } } : undefined,
      select: {
        quantity: true,
        location: { select: { name: true } },
        product: {
          select: {
            id: true,
            name: true,
            costPrice: true,
            reorderPoint: true,
            category: { select: { name: true } },
          },
        },
      },
    }),
    prisma.cashShift.findMany({
      where: {
        openedAt: { gte: rangeStart },
        ...(branchId ? { branchId } : {}),
      },
      select: {
        variance: true,
        status: true,
      },
    }),
  ]);

  let estimatedCostFallbackCount = 0;
  const branchBreakdown = new Map<string, FinanceBreakdownRow & BranchScoped>();
  const categoryBreakdown = new Map<string, FinanceBreakdownRow>();
  const productBreakdown = new Map<string, FinanceProductRow>();
  const paymentMix = new Map<string, number>();
  const refundMethods = new Map<string, { method: string; amount: number; count: number }>();
  let exchangeCount = 0;

  for (const sale of sales) {
    const saleMonth = monthKey(sale.createdAt);
    const bucket = buckets.get(saleMonth);
    if (bucket) {
      addToMonthBucket(bucket, "revenue", Number(sale.total));
    }

    const branchName = sale.cashier.branch?.name ?? "Unassigned";
    const branchKey = sale.cashier.branchId ?? "unassigned";
    const branchRow = upsertBreakdown(branchBreakdown, branchKey, () => ({
      branchId: sale.cashier.branchId ?? null,
      branchName,
      name: branchName,
      revenue: 0,
      refunds: 0,
      cogs: 0,
      grossProfit: 0,
      expenses: 0,
      netProfit: 0,
      marginPct: 0,
    }));
    branchRow.revenue += Number(sale.total);

    for (const payment of sale.payments) {
      paymentMix.set(payment.method, roundMoney((paymentMix.get(payment.method) ?? 0) + Number(payment.amount)));
      const paymentBucket = buckets.get(monthKey(payment.createdAt));
      if (paymentBucket) {
        addToMonthBucket(paymentBucket, "cashIn", Number(payment.amount));
      }
    }

    for (const item of sale.items) {
      const revenue = Number(item.total);
      const realizedCogs = item.realizedCogs === null ? Number(item.product.costPrice) * item.quantity : Number(item.realizedCogs);
      if (item.realizedCogs === null) {
        estimatedCostFallbackCount += 1;
      }
      const categoryName = item.product.category.name || "Uncategorized";
      const categoryRow = upsertBreakdown(categoryBreakdown, categoryName, () => ({
        name: categoryName,
        revenue: 0,
        refunds: 0,
        cogs: 0,
        grossProfit: 0,
        expenses: 0,
        netProfit: 0,
        marginPct: 0,
      }));
      categoryRow.revenue += revenue;
      categoryRow.cogs += realizedCogs;
      branchRow.cogs += realizedCogs;

      const productRow = productBreakdown.get(item.product.id) ?? {
        productId: item.product.id,
        name: item.product.name,
        categoryName,
        revenue: 0,
        refunds: 0,
        cogs: 0,
        grossProfit: 0,
        marginPct: 0,
        soldQty: 0,
      };
      productRow.revenue += revenue;
      productRow.cogs += realizedCogs;
      productRow.soldQty += item.quantity;
      productBreakdown.set(item.product.id, productRow);

      if (bucket) {
        addToMonthBucket(bucket, "cogs", realizedCogs);
      }
    }
  }

  for (const refund of refunds) {
    const refundMethodKey = refund.settlementMethod ?? (refund.refundMode === "EXCHANGE" ? "EXCHANGE" : "UNSPECIFIED");
    const refundMethodRow = refundMethods.get(refundMethodKey) ?? { method: refundMethodKey, amount: 0, count: 0 };
    refundMethodRow.amount = roundMoney(refundMethodRow.amount + Number(refund.amount));
    refundMethodRow.count += 1;
    refundMethods.set(refundMethodKey, refundMethodRow);
    if (refund.refundMode === "EXCHANGE") {
      exchangeCount += 1;
    }

    const bucket = buckets.get(monthKey(refund.createdAt));
    if (bucket) {
      addToMonthBucket(bucket, "refunds", Number(refund.amount));
      const restockedCost = refund.items.reduce((sum, item) => sum + Number(item.restockedCost), 0);
      if (restockedCost > 0) {
        addToMonthBucket(bucket, "cogs", -restockedCost);
      }
    }

    const branchName = refund.sale.cashier.branch?.name ?? "Unassigned";
    const branchKey = refund.sale.cashier.branchId ?? "unassigned";
    const branchRow = upsertBreakdown(branchBreakdown, branchKey, () => ({
      branchId: refund.sale.cashier.branchId ?? null,
      branchName,
      name: branchName,
      revenue: 0,
      refunds: 0,
      cogs: 0,
      grossProfit: 0,
      expenses: 0,
      netProfit: 0,
      marginPct: 0,
    }));
    branchRow.refunds += Number(refund.amount);
    branchRow.cogs -= refund.items.reduce((sum, item) => sum + Number(item.restockedCost), 0);

    for (const item of refund.items) {
      const categoryName = item.product.category.name || "Uncategorized";
      const categoryRow = upsertBreakdown(categoryBreakdown, categoryName, () => ({
        name: categoryName,
        revenue: 0,
        refunds: 0,
        cogs: 0,
        grossProfit: 0,
        expenses: 0,
        netProfit: 0,
        marginPct: 0,
      }));
      categoryRow.refunds += Number(item.amount);
      categoryRow.cogs -= Number(item.restockedCost);

      const productRow = productBreakdown.get(item.product.id);
      if (productRow) {
        productRow.refunds += Number(item.amount);
        productRow.cogs -= Number(item.restockedCost);
      }
    }
  }

  for (const expense of expenses) {
    const bucket = buckets.get(monthKey(expense.date));
    if (bucket) {
      addToMonthBucket(bucket, "expenses", Number(expense.amount));
    }
    const branchName = expense.user.branch?.name ?? "Unassigned";
    const branchKey = expense.user.branchId ?? "unassigned";
    const branchRow = upsertBreakdown(branchBreakdown, branchKey, () => ({
      branchId: expense.user.branchId ?? null,
      branchName,
      name: branchName,
      revenue: 0,
      refunds: 0,
      cogs: 0,
      grossProfit: 0,
      expenses: 0,
      netProfit: 0,
      marginPct: 0,
    }));
    branchRow.expenses += Number(expense.amount);
  }

  for (const payment of supplierPayments) {
    const bucket = buckets.get(monthKey(payment.paidAt));
    if (bucket) {
      addToMonthBucket(bucket, "supplierPaid", Number(payment.amount));
    }
  }

  const trend = Array.from(buckets.entries()).map(([month, bucket]) => finalizeMonth(month, bucket));
  const currentMonth = trend[trend.length - 1] ?? createMonthBucket(monthKey(asOf));
  const priorMonth = trend.length > 1 ? trend[trend.length - 2] : null;
  const trailing = finalizeMonth("trailing", Array.from(buckets.values()).reduce<MutableMonthBucket>(
    (acc, bucket) => ({
      revenue: roundMoney(acc.revenue + bucket.revenue),
      refunds: roundMoney(acc.refunds + bucket.refunds),
      cogs: roundMoney(acc.cogs + bucket.cogs),
      expenses: roundMoney(acc.expenses + bucket.expenses),
      cashIn: roundMoney(acc.cashIn + bucket.cashIn),
      supplierPaid: roundMoney(acc.supplierPaid + bucket.supplierPaid),
    }),
    { revenue: 0, refunds: 0, cogs: 0, expenses: 0, cashIn: 0, supplierPaid: 0 },
  ));

  const finalizedByBranch = Array.from(branchBreakdown.values())
    .map((row) => ({ ...finalizeBreakdown(row), branchId: row.branchId, branchName: row.branchName }))
    .sort((a, b) => b.netProfit - a.netProfit);
  const finalizedByCategory = Array.from(categoryBreakdown.values())
    .map((row) => finalizeBreakdown(row))
    .sort((a, b) => b.netProfit - a.netProfit);
  const finalizedByProduct = Array.from(productBreakdown.values())
    .map((row) => {
      const grossProfit = roundMoney(row.revenue - row.refunds - row.cogs);
      const base = row.revenue - row.refunds;
      return {
        ...row,
        revenue: roundMoney(row.revenue),
        refunds: roundMoney(row.refunds),
        cogs: roundMoney(row.cogs),
        grossProfit,
        marginPct: base > 0 ? Number(((grossProfit / base) * 100).toFixed(2)) : 0,
      };
    })
    .sort((a, b) => b.grossProfit - a.grossProfit);

  const deadStock = stockLevels
    .filter((row) => row.quantity > 0 && !productBreakdown.has(row.product.id))
    .map((row) => ({
      productId: row.product.id,
      productName: row.product.name,
      categoryName: row.product.category.name || "Uncategorized",
      onHand: row.quantity,
      carryingCost: roundMoney(row.quantity * Number(row.product.costPrice)),
    }))
    .sort((a, b) => b.carryingCost - a.carryingCost)
    .slice(0, 8);

  const slowMovers = stockLevels
    .filter((row) => row.quantity > 0)
    .map((row) => {
      const breakdown = productBreakdown.get(row.product.id);
      return {
        productId: row.product.id,
        productName: row.product.name,
        soldQty: breakdown?.soldQty ?? 0,
        onHand: row.quantity,
      };
    })
    .filter((row) => row.soldQty <= Math.max(1, Math.floor(row.onHand * 0.25)))
    .sort((a, b) => b.onHand - a.onHand)
    .slice(0, 8);

  const lowMarginProducts = finalizedByProduct
    .filter((row) => row.revenue > 0 && row.marginPct <= 12)
    .sort((a, b) => a.marginPct - b.marginPct)
    .slice(0, 8);

  const supplierBalances = purchaseOrders
    .map((po) => ({
      supplierId: po.supplierId,
      supplierName: po.supplier.name,
      outstanding: roundMoney(Number(po.total) - Number(po.paidAmount)),
      dueDate: po.dueDate,
    }))
    .filter((row) => row.outstanding > 0)
    .sort((a, b) => b.outstanding - a.outstanding)
    .slice(0, 8);

  const payablesAging = purchaseOrders.reduce(
    (acc, po) => {
      const outstanding = roundMoney(Number(po.total) - Number(po.paidAmount));
      if (outstanding <= 0) return acc;
      if (!po.dueDate) {
        acc.current = roundMoney(acc.current + outstanding);
        return acc;
      }
      const days = Math.max(
        0,
        Math.floor((startOfMonth(new Date()).getTime() - startOfMonth(po.dueDate).getTime()) / (24 * 60 * 60 * 1000)),
      );
      if (days <= 0) acc.current = roundMoney(acc.current + outstanding);
      else if (days <= 30) acc["1_30"] = roundMoney(acc["1_30"] + outstanding);
      else if (days <= 60) acc["31_60"] = roundMoney(acc["31_60"] + outstanding);
      else acc["61_plus"] = roundMoney(acc["61_plus"] + outstanding);
      return acc;
    },
    { current: 0, "1_30": 0, "31_60": 0, "61_plus": 0 },
  );

  const cashVariance = roundMoney(cashShifts.reduce((sum, shift) => sum + Number(shift.variance), 0));

  const receivables = customers.map((customer) => ({
    customerId: customer.id,
    customerName: customer.name,
    outstanding: roundMoney(Math.abs(Number(customer.creditBalance))),
  }));

  const payload: FinanceAnalyticsPayload = {
    meta: {
      branchId,
      months,
      asOf: asOf.toISOString(),
      estimatedCostFallbackCount,
    },
    overview: {
      currentMonth,
      priorMonth,
      trailing,
    },
    trend,
    breakdowns: {
      byBranch: finalizedByBranch,
      byCategory: finalizedByCategory.slice(0, 8),
      byProduct: finalizedByProduct.slice(0, 10),
      paymentMix: Array.from(paymentMix.entries())
        .map(([method, amount]) => ({ method, amount: roundMoney(amount) }))
        .sort((a, b) => b.amount - a.amount),
      refundMethods: Array.from(refundMethods.values()).sort((a, b) => b.amount - a.amount),
      supplierBalances: supplierBalances.map(({ dueDate: _dueDate, ...row }) => row),
      receivables,
    },
    operations: {
      deadStock,
      slowMovers,
      lowMarginProducts,
      payablesOutstanding: roundMoney(supplierBalances.reduce((sum, row) => sum + row.outstanding, 0)),
      receivablesOutstanding: roundMoney(receivables.reduce((sum, row) => sum + row.outstanding, 0)),
      payablesAging,
      cashVariance,
      exchangeCount,
    },
    recommendations: [],
  };

  payload.recommendations = buildFinanceRecommendations(payload);
  return payload;
}
