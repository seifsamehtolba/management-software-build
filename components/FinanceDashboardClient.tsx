"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AppPage,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  SectionTitle,
  Select,
  StatusBadge,
} from "@/components/ui/primitives";
import { useLang } from "@/lib/i18n";
import { errorMessageFromJson, parseResponseJson } from "@/lib/parseResponseJson";
import { hasPermission, normalizePermissions, PERMISSIONS } from "@/lib/permissions";

type FinanceMonthMetrics = {
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

type FinanceBreakdownRow = {
  name: string;
  revenue: number;
  refunds: number;
  cogs: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
  marginPct: number;
};

type FinanceProductRow = {
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

type FinanceRecommendation = {
  kind: "margin_down" | "refund_rate_high" | "cashflow_pressure" | "dead_stock" | "low_margin_products";
  severity: "info" | "warning" | "danger";
  value: number;
  benchmark?: number;
};

type FinanceDashboardData = {
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
    byBranch: Array<FinanceBreakdownRow & { branchId: string | null; branchName: string }>;
    byCategory: FinanceBreakdownRow[];
    byProduct: FinanceProductRow[];
    paymentMix: Array<{ method: string; amount: number }>;
    refundMethods: Array<{ method: string; amount: number; count: number }>;
    supplierBalances: Array<{ supplierId: string; supplierName: string; outstanding: number }>;
    receivables: Array<{ customerId: string; customerName: string; outstanding: number }>;
  };
  operations: {
    deadStock: Array<{ productId: string; productName: string; categoryName: string; onHand: number; carryingCost: number }>;
    slowMovers: Array<{ productId: string; productName: string; soldQty: number; onHand: number }>;
    lowMarginProducts: FinanceProductRow[];
    payablesOutstanding: number;
    receivablesOutstanding: number;
    payablesAging: { current: number; "1_30": number; "31_60": number; "61_plus": number };
    cashVariance: number;
    exchangeCount: number;
  };
  recommendations: FinanceRecommendation[];
};

type ExpenseRow = {
  id: string;
  amount: number;
  date: string;
  description: string;
  categoryName: string;
  userName: string;
  branchName: string;
};

type SupplierPaymentRow = {
  id: string;
  poNumber: string;
  supplierName: string;
  branchName: string;
  total: number;
  paidAmount: number;
  outstanding: number;
  payments: Array<{
    id: string;
    amount: number;
    method: string;
    note?: string | null;
    paidAt: string;
  }>;
};

type MePayload = {
  id: string;
  permissions: string[];
};

const PIE_COLORS = ["#6366f1", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];
const CHART_TOOLTIP = {
  contentStyle: {
    margin: 0,
    padding: 10,
    backgroundColor: "var(--surface-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    boxShadow: "var(--shadow-md)",
  },
  itemStyle: { color: "var(--foreground)" },
  labelStyle: { color: "var(--muted)", fontWeight: 600 },
} as const;

function ChartSkeleton({ label }: { label: string }) {
  return (
    <div className="flex h-64 flex-col justify-end rounded-xl p-3" style={{ background: "var(--surface-muted)" }}>
      <div className="mb-2 h-3 w-24 rounded animate-pulse" style={{ background: "var(--border)" }} />
      <div className="space-y-2">
        <div className="h-3 w-full rounded animate-pulse" style={{ background: "var(--border)" }} />
        <div className="h-3 w-[85%] rounded animate-pulse" style={{ background: "var(--border)" }} />
        <div className="h-32 w-full rounded-lg animate-pulse opacity-80" style={{ background: "var(--border)" }} />
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}

function recommendationTone(severity: FinanceRecommendation["severity"]) {
  if (severity === "danger") return "danger";
  if (severity === "warning") return "warning";
  return "neutral";
}

export default function FinanceDashboardClient() {
  const { t, lang } = useLang();
  const tf = t.finance;
  const [months, setMonths] = useState("12");
  const [branchId, setBranchId] = useState("");
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [analytics, setAnalytics] = useState<FinanceDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [payables, setPayables] = useState<SupplierPaymentRow[]>([]);
  const [savingExpense, setSavingExpense] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);
  const [expenseForm, setExpenseForm] = useState({
    categoryName: "",
    amount: "",
    description: "",
    date: "",
  });
  const [paymentForm, setPaymentForm] = useState({
    poId: "",
    amount: "",
    method: "BANK_TRANSFER",
    note: "",
  });

  const locale = lang === "ar" ? "ar-EG" : "en-EG";
  const fmtMoney = (value: number) =>
    new Intl.NumberFormat(locale, { style: "currency", currency: "EGP", maximumFractionDigits: 2 }).format(value);
  const fmtPct = (value: number) => `${value.toFixed(1)}%`;

  const canManageExpenses = useMemo(
    () => hasPermission(normalizePermissions(permissions), PERMISSIONS.financeExpensesManage),
    [permissions],
  );
  const canManageSupplierPayments = useMemo(
    () => hasPermission(normalizePermissions(permissions), PERMISSIONS.financeSupplierPaymentsManage),
    [permissions],
  );

  useEffect(() => {
    const run = async () => {
      const [meRes, branchRes] = await Promise.allSettled([fetch("/api/me"), fetch("/api/branches")]);
      if (meRes.status === "fulfilled" && meRes.value.ok) {
        const me = await parseResponseJson<MePayload>(meRes.value);
        if (me?.permissions) setPermissions(me.permissions);
      }
      if (branchRes.status === "fulfilled" && branchRes.value.ok) {
        const branchRows = await parseResponseJson<Array<{ id: string; name: string }>>(branchRes.value);
        if (Array.isArray(branchRows)) setBranches(branchRows);
      }
    };
    void run();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setStatus("");
      const params = new URLSearchParams();
      params.set("months", months);
      if (branchId) params.set("branchId", branchId);
      const [analyticsRes, expensesRes, payablesRes] = await Promise.all([
        fetch(`/api/finance/dashboard?${params.toString()}`, { cache: "no-store" }),
        fetch(`/api/finance/expenses?${params.toString()}`, { cache: "no-store" }),
        fetch(`/api/finance/supplier-payments?${params.toString()}`, { cache: "no-store" }),
      ]);

      if (!analyticsRes.ok) {
        const err = await parseResponseJson<{ message?: string }>(analyticsRes);
        if (!cancelled) setStatus(errorMessageFromJson(err, t.errors.generic));
        setLoading(false);
        return;
      }

      const [analyticsJson, expensesJson, payablesJson] = await Promise.all([
        parseResponseJson<FinanceDashboardData>(analyticsRes),
        expensesRes.ok ? parseResponseJson<ExpenseRow[]>(expensesRes) : Promise.resolve([]),
        payablesRes.ok ? parseResponseJson<SupplierPaymentRow[]>(payablesRes) : Promise.resolve([]),
      ]);

      if (cancelled) return;
      setAnalytics(analyticsJson ?? null);
      setExpenses(Array.isArray(expensesJson) ? expensesJson : []);
      setPayables(Array.isArray(payablesJson) ? payablesJson : []);
      setLoading(false);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [branchId, months, t.errors.generic]);

  const trendData = useMemo(
    () =>
      analytics?.trend.map((row) => ({
        ...row,
        label: new Date(`${row.month}-01T00:00:00.000Z`).toLocaleDateString(locale, { month: "short", year: "numeric" }),
      })) ?? [],
    [analytics, locale],
  );

  async function submitExpense() {
    setSavingExpense(true);
    const res = await fetch("/api/finance/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        categoryName: expenseForm.categoryName,
        amount: Number(expenseForm.amount),
        description: expenseForm.description,
        date: expenseForm.date || undefined,
      }),
    });
    const payload = await parseResponseJson<{ message?: string }>(res);
    if (!res.ok) {
      setStatus(errorMessageFromJson(payload, t.errors.generic));
      setSavingExpense(false);
      return;
    }
    setExpenseForm({ categoryName: "", amount: "", description: "", date: "" });
    setSavingExpense(false);
    setStatus(tf.expenseSaved);
    const refresh = await fetch(`/api/finance/expenses?months=${months}${branchId ? `&branchId=${branchId}` : ""}`, { cache: "no-store" });
    const refreshJson = await parseResponseJson<ExpenseRow[]>(refresh);
    setExpenses(Array.isArray(refreshJson) ? refreshJson : []);
  }

  async function submitSupplierPayment() {
    setSavingPayment(true);
    const res = await fetch("/api/finance/supplier-payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        poId: paymentForm.poId,
        amount: Number(paymentForm.amount),
        method: paymentForm.method,
        note: paymentForm.note,
      }),
    });
    const payload = await parseResponseJson<{ message?: string }>(res);
    if (!res.ok) {
      setStatus(errorMessageFromJson(payload, t.errors.generic));
      setSavingPayment(false);
      return;
    }
    setPaymentForm({ poId: "", amount: "", method: "BANK_TRANSFER", note: "" });
    setSavingPayment(false);
    setStatus(tf.paymentSaved);
    const params = new URLSearchParams();
    params.set("months", months);
    if (branchId) params.set("branchId", branchId);
    const refresh = await fetch(`/api/finance/supplier-payments?${params.toString()}`, { cache: "no-store" });
    const refreshJson = await parseResponseJson<SupplierPaymentRow[]>(refresh);
    setPayables(Array.isArray(refreshJson) ? refreshJson : []);
  }

  function renderRecommendation(recommendation: FinanceRecommendation) {
    switch (recommendation.kind) {
      case "margin_down":
        return `${tf.recMarginDown} ${fmtPct(recommendation.value)} / ${fmtPct(recommendation.benchmark ?? 0)}`;
      case "refund_rate_high":
        return `${tf.recRefundHigh} ${fmtPct(recommendation.value)}`;
      case "cashflow_pressure":
        return `${tf.recCashPressure} ${fmtMoney(recommendation.value)}`;
      case "dead_stock":
        return `${tf.recDeadStock} ${recommendation.value}`;
      case "low_margin_products":
        return `${tf.recLowMargin} ${recommendation.value}`;
      default:
        return recommendation.kind;
    }
  }

  const current = analytics?.overview.currentMonth;
  const trailing = analytics?.overview.trailing;

  return (
    <AppPage>
      <PageHeader
        title={tf.title}
        subtitle={tf.workspaceSubtitle}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Select value={months} onChange={(e) => setMonths(e.target.value)} className="min-w-[140px]">
              <option value="6">{tf.last6Months}</option>
              <option value="12">{tf.last12Months}</option>
              <option value="24">{tf.last24Months}</option>
            </Select>
            <Select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="min-w-[160px]">
              <option value="">{tf.allBranches}</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </Select>
          </div>
        )}
      />

      {status ? (
        <p className="mb-4 text-sm" style={{ color: "var(--muted)" }}>
          {status}
        </p>
      ) : null}

      {loading || !analytics || !current || !trailing ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartSkeleton label={tf.monthlyTrend} />
          <ChartSkeleton label={tf.branchProfitability} />
        </div>
      ) : (
        <>
          {analytics.meta.estimatedCostFallbackCount > 0 ? (
            <Card className="mb-4">
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                {tf.dataQualityNotice} {analytics.meta.estimatedCostFallbackCount}
              </p>
            </Card>
          ) : null}

          <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
            {[
              { label: tf.revenue, value: current.revenue },
              { label: tf.refunds, value: current.refunds },
              { label: tf.cogs, value: current.cogs },
              { label: tf.grossProfit, value: current.grossProfit },
              { label: tf.netProfit, value: current.netProfit },
            ].map((metric) => (
              <Card key={metric.label}>
                <p className="text-sm" style={{ color: "var(--muted)" }}>{metric.label}</p>
                <p className="text-xl font-bold">{fmtMoney(metric.value)}</p>
              </Card>
            ))}
          </section>

          <section className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Card>
              <p className="text-sm" style={{ color: "var(--muted)" }}>{tf.margin}</p>
              <p className="text-xl font-bold">{fmtPct(current.marginPct)}</p>
            </Card>
            <Card>
              <p className="text-sm" style={{ color: "var(--muted)" }}>{tf.cashIn}</p>
              <p className="text-xl font-bold">{fmtMoney(current.cashIn)}</p>
            </Card>
            <Card>
              <p className="text-sm" style={{ color: "var(--muted)" }}>{tf.supplierPaid}</p>
              <p className="text-xl font-bold">{fmtMoney(current.supplierPaid)}</p>
            </Card>
            <Card>
              <p className="text-sm" style={{ color: "var(--muted)" }}>{tf.netCashflow}</p>
              <p className="text-xl font-bold">{fmtMoney(current.netCashflow)}</p>
            </Card>
          </section>

          <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card>
              <SectionTitle title={tf.monthlyTrend} subtitle={tf.currentVsTrailing} />
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="label" />
                    <YAxis />
                    <Tooltip {...CHART_TOOLTIP} />
                    <Line type="monotone" dataKey="revenue" stroke="#6366f1" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="netProfit" stroke="#10b981" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="expenses" stroke="#ef4444" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card>
              <SectionTitle title={tf.cashflow} subtitle={tf.thisMonth} />
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={[
                      { name: tf.cashIn, value: current.cashIn },
                      { name: tf.expenses, value: current.expenses },
                      { name: tf.supplierPaid, value: current.supplierPaid },
                      { name: tf.netCashflow, value: current.netCashflow },
                    ]}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip {...CHART_TOOLTIP} />
                    <Bar dataKey="value" fill="#06b6d4" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <SectionTitle title={tf.branchProfitability} subtitle={tf.trailingWindow} />
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={analytics.breakdowns.byBranch}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="branchName" />
                    <YAxis />
                    <Tooltip {...CHART_TOOLTIP} />
                    <Bar dataKey="netProfit" fill="#10b981" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card>
              <SectionTitle title={tf.paymentMix} subtitle={tf.trailingWindow} />
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={analytics.breakdowns.paymentMix} dataKey="amount" nameKey="method" outerRadius={90} innerRadius={45}>
                      {analytics.breakdowns.paymentMix.map((entry, index) => (
                        <Cell key={entry.method} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip {...CHART_TOOLTIP} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card>
              <SectionTitle title={tf.categoryProfitability} subtitle={tf.trailingWindow} />
              <div className="space-y-3">
                {analytics.breakdowns.byCategory.length === 0 ? (
                  <EmptyState title={tf.noData} />
                ) : (
                  analytics.breakdowns.byCategory.map((row) => (
                    <div key={row.name} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: "var(--surface-muted)" }}>
                      <div>
                        <p className="font-medium">{row.name}</p>
                        <p className="text-sm" style={{ color: "var(--muted)" }}>{fmtPct(row.marginPct)}</p>
                      </div>
                      <p className="font-semibold">{fmtMoney(row.netProfit)}</p>
                    </div>
                  ))
                )}
              </div>
            </Card>

            <Card>
              <SectionTitle title={tf.recommendations} subtitle={tf.whatToImprove} />
              <div className="space-y-3">
                {analytics.recommendations.length === 0 ? (
                  <EmptyState title={tf.noRecommendations} />
                ) : (
                  analytics.recommendations.map((recommendation) => (
                    <div key={recommendation.kind} className="rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <StatusBadge tone={recommendationTone(recommendation.severity)}>{recommendation.severity}</StatusBadge>
                      </div>
                      <p className="text-sm font-medium">{renderRecommendation(recommendation)}</p>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Card>
              <SectionTitle title={tf.topProducts} subtitle={tf.trailingWindow} />
              <div className="space-y-3">
                {analytics.breakdowns.byProduct.slice(0, 6).map((product) => (
                  <div key={product.productId} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: "var(--surface-muted)" }}>
                    <div>
                      <p className="font-medium">{product.name}</p>
                      <p className="text-sm" style={{ color: "var(--muted)" }}>{product.categoryName}</p>
                    </div>
                    <p className="font-semibold">{fmtMoney(product.grossProfit)}</p>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <SectionTitle title={tf.deadStock} subtitle={tf.operationalWarnings} />
              <div className="space-y-3">
                {analytics.operations.deadStock.length === 0 ? (
                  <EmptyState title={tf.noDeadStock} />
                ) : (
                  analytics.operations.deadStock.map((product) => (
                    <div key={product.productId} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: "var(--surface-muted)" }}>
                      <div>
                        <p className="font-medium">{product.productName}</p>
                        <p className="text-sm" style={{ color: "var(--muted)" }}>{tf.onHand}: {product.onHand}</p>
                      </div>
                      <p className="font-semibold">{fmtMoney(product.carryingCost)}</p>
                    </div>
                  ))
                )}
              </div>
            </Card>

            <Card>
              <SectionTitle title={tf.lowMarginProducts} subtitle={tf.operationalWarnings} />
              <div className="space-y-3">
                {analytics.operations.lowMarginProducts.length === 0 ? (
                  <EmptyState title={tf.noLowMargin} />
                ) : (
                  analytics.operations.lowMarginProducts.map((product) => (
                    <div key={product.productId} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: "var(--surface-muted)" }}>
                      <div>
                        <p className="font-medium">{product.name}</p>
                        <p className="text-sm" style={{ color: "var(--muted)" }}>{fmtPct(product.marginPct)}</p>
                      </div>
                      <p className="font-semibold">{fmtMoney(product.grossProfit)}</p>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card>
              <SectionTitle title={tf.supplierBalances} subtitle={fmtMoney(analytics.operations.payablesOutstanding)} />
              <div className="space-y-3">
                {analytics.breakdowns.supplierBalances.length === 0 ? (
                  <EmptyState title={tf.noPayables} />
                ) : (
                  analytics.breakdowns.supplierBalances.map((supplier) => (
                    <div key={supplier.supplierId} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: "var(--surface-muted)" }}>
                      <p className="font-medium">{supplier.supplierName}</p>
                      <p className="font-semibold">{fmtMoney(supplier.outstanding)}</p>
                    </div>
                  ))
                )}
              </div>
            </Card>

            <Card>
              <SectionTitle title={tf.receivables} subtitle={fmtMoney(analytics.operations.receivablesOutstanding)} />
              <div className="space-y-3">
                {analytics.breakdowns.receivables.length === 0 ? (
                  <EmptyState title={tf.noReceivables} />
                ) : (
                  analytics.breakdowns.receivables.map((customer) => (
                    <div key={customer.customerId} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: "var(--surface-muted)" }}>
                      <p className="font-medium">{customer.customerName}</p>
                      <p className="font-semibold">{fmtMoney(customer.outstanding)}</p>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Card>
              <SectionTitle title="Returns settlement mix" subtitle={`${analytics.operations.exchangeCount} exchanges`} />
              <div className="space-y-3">
                {analytics.breakdowns.refundMethods.length === 0 ? (
                  <EmptyState title="No refunds in this period." />
                ) : (
                  analytics.breakdowns.refundMethods.map((row) => (
                    <div key={row.method} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: "var(--surface-muted)" }}>
                      <div>
                        <p className="font-medium">{row.method}</p>
                        <p className="text-sm" style={{ color: "var(--muted)" }}>{row.count} transactions</p>
                      </div>
                      <p className="font-semibold">{fmtMoney(row.amount)}</p>
                    </div>
                  ))
                )}
              </div>
            </Card>
            <Card>
              <SectionTitle title="Payables aging" subtitle={fmtMoney(analytics.operations.payablesOutstanding)} />
              <div className="space-y-3">
                {[
                  { label: "Current", value: analytics.operations.payablesAging.current },
                  { label: "1-30 days", value: analytics.operations.payablesAging["1_30"] },
                  { label: "31-60 days", value: analytics.operations.payablesAging["31_60"] },
                  { label: "61+ days", value: analytics.operations.payablesAging["61_plus"] },
                ].map((bucket) => (
                  <div key={bucket.label} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: "var(--surface-muted)" }}>
                    <p className="font-medium">{bucket.label}</p>
                    <p className="font-semibold">{fmtMoney(bucket.value)}</p>
                  </div>
                ))}
              </div>
            </Card>
            <Card>
              <SectionTitle title="Cash variance" subtitle={fmtMoney(analytics.operations.cashVariance)} />
              <div className="rounded-lg px-3 py-3" style={{ background: "var(--surface-muted)" }}>
                <p className="text-sm" style={{ color: "var(--muted)" }}>
                  Shift-close over / short total for the selected period.
                </p>
                <p className="mt-3 text-2xl font-semibold">{fmtMoney(analytics.operations.cashVariance)}</p>
              </div>
            </Card>
          </div>

          {(canManageExpenses || canManageSupplierPayments) ? (
            <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
              {canManageExpenses ? (
                <Card>
                  <SectionTitle title={tf.recordExpense} subtitle={tf.recentExpenses} />
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    <Input
                      value={expenseForm.categoryName}
                      onChange={(e) => setExpenseForm((prev) => ({ ...prev, categoryName: e.target.value }))}
                      placeholder={tf.categoryName}
                    />
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={expenseForm.amount}
                      onChange={(e) => setExpenseForm((prev) => ({ ...prev, amount: e.target.value }))}
                      placeholder={tf.amount}
                    />
                    <Input
                      value={expenseForm.description}
                      onChange={(e) => setExpenseForm((prev) => ({ ...prev, description: e.target.value }))}
                      placeholder={tf.description}
                    />
                    <Input
                      type="date"
                      value={expenseForm.date}
                      onChange={(e) => setExpenseForm((prev) => ({ ...prev, date: e.target.value }))}
                    />
                  </div>
                  <Button className="mt-3" onClick={() => void submitExpense()} disabled={savingExpense}>
                    {savingExpense ? tf.saving : tf.saveExpense}
                  </Button>
                  <div className="mt-4 space-y-2">
                    {expenses.slice(0, 5).map((expense) => (
                      <div key={expense.id} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: "var(--surface-muted)" }}>
                        <div>
                          <p className="font-medium">{expense.categoryName}</p>
                          <p className="text-sm" style={{ color: "var(--muted)" }}>{expense.description}</p>
                        </div>
                        <p className="font-semibold">{fmtMoney(expense.amount)}</p>
                      </div>
                    ))}
                  </div>
                </Card>
              ) : null}

              {canManageSupplierPayments ? (
                <Card>
                  <SectionTitle title={tf.recordSupplierPayment} subtitle={tf.openPayables} />
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    <Select
                      value={paymentForm.poId}
                      onChange={(e) => setPaymentForm((prev) => ({ ...prev, poId: e.target.value }))}
                    >
                      <option value="">{tf.selectPo}</option>
                      {payables
                        .filter((po) => po.outstanding > 0)
                        .map((po) => (
                          <option key={po.id} value={po.id}>
                            {po.poNumber} - {po.supplierName}
                          </option>
                        ))}
                    </Select>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={paymentForm.amount}
                      onChange={(e) => setPaymentForm((prev) => ({ ...prev, amount: e.target.value }))}
                      placeholder={tf.amount}
                    />
                    <Select
                      value={paymentForm.method}
                      onChange={(e) => setPaymentForm((prev) => ({ ...prev, method: e.target.value }))}
                    >
                      <option value="BANK_TRANSFER">BANK_TRANSFER</option>
                      <option value="CASH">CASH</option>
                      <option value="CARD">CARD</option>
                      <option value="FAWRY">FAWRY</option>
                      <option value="VODAFONE_CASH">VODAFONE_CASH</option>
                    </Select>
                    <Input
                      value={paymentForm.note}
                      onChange={(e) => setPaymentForm((prev) => ({ ...prev, note: e.target.value }))}
                      placeholder={tf.note}
                    />
                  </div>
                  <Button className="mt-3" onClick={() => void submitSupplierPayment()} disabled={savingPayment}>
                    {savingPayment ? tf.saving : tf.saveSupplierPayment}
                  </Button>
                  <div className="mt-4 space-y-2">
                    {payables
                      .filter((po) => po.outstanding > 0)
                      .slice(0, 5)
                      .map((po) => (
                        <div key={po.id} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: "var(--surface-muted)" }}>
                          <div>
                            <p className="font-medium">{po.poNumber}</p>
                            <p className="text-sm" style={{ color: "var(--muted)" }}>{po.supplierName}</p>
                          </div>
                          <p className="font-semibold">{fmtMoney(po.outstanding)}</p>
                        </div>
                      ))}
                  </div>
                </Card>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </AppPage>
  );
}
