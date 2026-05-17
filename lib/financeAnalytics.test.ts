import { describe, expect, it } from "vitest";
import { buildFinanceRecommendations } from "./financeAnalytics";

describe("buildFinanceRecommendations", () => {
  it("flags margin decline, refund pressure, and cashflow pressure", () => {
    const recommendations = buildFinanceRecommendations({
      overview: {
        currentMonth: {
          month: "2026-05",
          revenue: 100000,
          refunds: 8000,
          cogs: 70000,
          grossProfit: 22000,
          expenses: 30000,
          netProfit: -8000,
          marginPct: 22,
          cashIn: 45000,
          supplierPaid: 60000,
          netCashflow: -15000,
        },
        priorMonth: {
          month: "2026-04",
          revenue: 98000,
          refunds: 2000,
          cogs: 65000,
          grossProfit: 31000,
          expenses: 24000,
          netProfit: 7000,
          marginPct: 31.63,
          cashIn: 70000,
          supplierPaid: 39000,
          netCashflow: 7000,
        },
        trailing: {
          month: "trailing",
          revenue: 198000,
          refunds: 10000,
          cogs: 135000,
          grossProfit: 53000,
          expenses: 54000,
          netProfit: -1000,
          marginPct: 28.19,
          cashIn: 115000,
          supplierPaid: 99000,
          netCashflow: 16000,
        },
      },
      operations: {
        deadStock: [{ productId: "p1", productName: "Router", categoryName: "Networking", onHand: 6, carryingCost: 2400 }],
        lowMarginProducts: [
          {
            productId: "p2",
            name: "Cable",
            categoryName: "Accessories",
            revenue: 1000,
            refunds: 0,
            cogs: 920,
            grossProfit: 80,
            marginPct: 8,
            soldQty: 40,
          },
        ],
        slowMovers: [],
        payablesOutstanding: 0,
        receivablesOutstanding: 0,
        payablesAging: { current: 0, "1_30": 0, "31_60": 0, "61_plus": 0 },
        cashVariance: 0,
        exchangeCount: 0,
      },
    });

    expect(recommendations.map((entry) => entry.kind)).toEqual([
      "margin_down",
      "refund_rate_high",
      "cashflow_pressure",
      "dead_stock",
      "low_margin_products",
    ]);
  });

  it("returns no recommendations for a healthy month", () => {
    const recommendations = buildFinanceRecommendations({
      overview: {
        currentMonth: {
          month: "2026-05",
          revenue: 120000,
          refunds: 1000,
          cogs: 70000,
          grossProfit: 49000,
          expenses: 12000,
          netProfit: 37000,
          marginPct: 41.18,
          cashIn: 90000,
          supplierPaid: 30000,
          netCashflow: 48000,
        },
        priorMonth: {
          month: "2026-04",
          revenue: 115000,
          refunds: 1200,
          cogs: 69000,
          grossProfit: 44800,
          expenses: 14000,
          netProfit: 30800,
          marginPct: 39.37,
          cashIn: 85000,
          supplierPaid: 32000,
          netCashflow: 39000,
        },
        trailing: {
          month: "trailing",
          revenue: 235000,
          refunds: 2200,
          cogs: 139000,
          grossProfit: 93800,
          expenses: 26000,
          netProfit: 67800,
          marginPct: 40.28,
          cashIn: 175000,
          supplierPaid: 62000,
          netCashflow: 87000,
        },
      },
      operations: {
        deadStock: [],
        lowMarginProducts: [],
        slowMovers: [],
        payablesOutstanding: 0,
        receivablesOutstanding: 0,
        payablesAging: { current: 0, "1_30": 0, "31_60": 0, "61_plus": 0 },
        cashVariance: 0,
        exchangeCount: 0,
      },
    });

    expect(recommendations).toHaveLength(0);
  });
});
