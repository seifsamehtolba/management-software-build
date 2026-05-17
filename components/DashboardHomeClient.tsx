"use client";

import Link from "next/link";
import { parseResponseJson } from "@/lib/parseResponseJson";
import { useSession } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";
import { HelpCircle, X as XIcon } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { hasPermission, normalizePermissions, PERMISSIONS } from "@/lib/permissions";
import { useLang } from "@/lib/i18n";

type DashboardData = {
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

type DashboardDefaults = {
  showKpis: boolean;
  showRecentSales: boolean;
  showRecentRepairs: boolean;
  showQuickActions: boolean;
};

const KEY = "dashboard-visibility";
const ORDER_KEY = "dashboard-order";
const FILTERS_KEY_PREFIX = "dashboard-insights-filters:";
const ALLOWED_RANGE_DAYS = [7, 14, 30, 90] as const;

type SectionId = "kpis" | "recentSales" | "recentRepairs" | "quickActions";
const defaultOrder: SectionId[] = ["kpis", "recentSales", "recentRepairs", "quickActions"];
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

function filtersStorageKey(userId: string | undefined) {
  return `${FILTERS_KEY_PREFIX}${userId ?? "guest"}`;
}

function readSavedFilters(userId: string | undefined): { rangeDays: number; branchId: string } {
  if (typeof window === "undefined") return { rangeDays: 14, branchId: "" };
  try {
    const raw = localStorage.getItem(filtersStorageKey(userId));
    if (!raw) return { rangeDays: 14, branchId: "" };
    const p = JSON.parse(raw) as { rangeDays?: unknown; branchId?: unknown };
    const rangeDays =
      typeof p.rangeDays === "number" && ALLOWED_RANGE_DAYS.includes(p.rangeDays as (typeof ALLOWED_RANGE_DAYS)[number])
        ? p.rangeDays
        : 14;
    const branchId = typeof p.branchId === "string" ? p.branchId : "";
    return { rangeDays, branchId };
  } catch {
    return { rangeDays: 14, branchId: "" };
  }
}

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

function formatMoney(value: number) {
  return new Intl.NumberFormat("ar-EG", {
    style: "currency",
    currency: "EGP",
    maximumFractionDigits: 2,
  }).format(value);
}

export function DashboardHomeClient({
  data,
  defaults,
  branches,
  deltas,
}: {
  data: DashboardData;
  defaults: DashboardDefaults;
  branches: Array<{ id: string; name: string }>;
  deltas: {
    salesTodayPct: number;
    revenuePct: number;
    grossProfitPct: number;
    openRepairsDiff: number;
    lowStockDiff: number;
  };
}) {
  const { data: session, status: sessionStatus } = useSession();
  const { t, lang } = useLang();
  const [rangeDays, setRangeDays] = useState(14);
  const [branchId, setBranchId] = useState("");
  const [filtersHydrated, setFiltersHydrated] = useState(false);
  const [liveData, setLiveData] = useState<DashboardData>(data);
  const [liveDeltas, setLiveDeltas] = useState(deltas);
  const [insightLoading, setInsightLoading] = useState(false);
  const [visibility, setVisibility] = useState<DashboardDefaults>(() => {
    if (typeof window === "undefined") return defaults;
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults;
    try { return JSON.parse(raw) as DashboardDefaults; }
    catch { return defaults; }
  });
  const [showCustomize, setShowCustomize] = useState(false);
  const [welcomeDismissed, setWelcomeDismissed] = useState(true);
  useEffect(() => {
    const dismissed = localStorage.getItem("welcome-guide-dismissed");
    if (!dismissed) setWelcomeDismissed(false);
  }, []);
  const dismissWelcome = () => {
    localStorage.setItem("welcome-guide-dismissed", "1");
    setWelcomeDismissed(true);
  };
  const [order, setOrder] = useState<SectionId[]>(() => {
    if (typeof window === "undefined") return defaultOrder;
    const raw = localStorage.getItem(ORDER_KEY);
    if (!raw) return defaultOrder;
    try {
      const parsed = JSON.parse(raw) as SectionId[];
      if (Array.isArray(parsed) && parsed.length === 4) return parsed;
      return defaultOrder;
    } catch { return defaultOrder; }
  });
  const [dragging, setDragging] = useState<SectionId | null>(null);
  const permissions = useMemo(
    () => normalizePermissions(session?.user?.permissions ?? []),
    [session?.user?.permissions],
  );

  useEffect(() => { localStorage.setItem(KEY, JSON.stringify(visibility)); }, [visibility]);
  useEffect(() => { localStorage.setItem(ORDER_KEY, JSON.stringify(order)); }, [order]);

  useEffect(() => {
    if (sessionStatus === "loading") return;
    const uid = session?.user?.id;
    const saved = readSavedFilters(uid);
    setRangeDays(saved.rangeDays);
    setBranchId(saved.branchId);
    setFiltersHydrated(true);
  }, [session?.user?.id, sessionStatus]);

  useEffect(() => {
    if (!filtersHydrated) return;
    localStorage.setItem(
      filtersStorageKey(session?.user?.id),
      JSON.stringify({ rangeDays, branchId }),
    );
  }, [filtersHydrated, session?.user?.id, rangeDays, branchId]);

  useEffect(() => {
    if (!filtersHydrated) return;
    let cancelled = false;
    const run = async () => {
      setInsightLoading(true);
      const params = new URLSearchParams();
      params.set("days", String(rangeDays));
      if (branchId) params.set("branchId", branchId);
      const res = await fetch(`/api/dashboard/insights?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) { setInsightLoading(false); return; }
      const payload = await parseResponseJson<{ data: DashboardData; deltas: typeof deltas }>(res);
      if (cancelled) return;
      if (!payload?.data) { setInsightLoading(false); return; }
      setLiveData(payload.data);
      setLiveDeltas(payload.deltas);
      setInsightLoading(false);
    };
    void run();
    return () => { cancelled = true; };
  }, [filtersHydrated, branchId, rangeDays]);

  const cards = useMemo(
    () => [
      {
        label: t.dashboard.revenueToday,
        value: formatMoney(liveData.salesToday),
        helper: `${liveData.salesTodayCount} ${t.dashboard.completedSales} • ${liveDeltas.salesTodayPct >= 0 ? "+" : ""}${liveDeltas.salesTodayPct}%`,
      },
      {
        label: t.dashboard.openRepairs,
        value: String(liveData.openRepairsCount),
        helper: `${t.dashboard.changeVsPrior}: ${liveDeltas.openRepairsDiff >= 0 ? "+" : ""}${liveDeltas.openRepairsDiff}`,
      },
      {
        label: t.dashboard.lowStockAlerts,
        value: String(liveData.lowStockCount),
        helper: `${t.dashboard.changeVsPrior}: ${liveDeltas.lowStockDiff >= 0 ? "+" : ""}${liveDeltas.lowStockDiff}`,
      },
      {
        label: t.dashboard.activeProducts,
        value: String(liveData.activeProductsCount),
        helper: t.dashboard.currentlySellable,
      },
      {
        label: t.dashboard.grossProfit,
        value: formatMoney(liveData.profitSummary.grossProfit),
        helper: `${liveData.profitSummary.grossMarginPct.toFixed(2)}% ${t.dashboard.margin} • ${liveDeltas.grossProfitPct >= 0 ? "+" : ""}${liveDeltas.grossProfitPct}%`,
      },
      {
        label: `${t.dashboard.cogs} (${t.finance.period})`,
        value: formatMoney(liveData.profitSummary.cogs),
        helper: `${t.dashboard.revenueWindow}: ${formatMoney(liveData.profitSummary.revenue)} • ${liveDeltas.revenuePct >= 0 ? "+" : ""}${liveDeltas.revenuePct}%`,
      },
    ],
    [liveData, liveDeltas, t],
  );

  const sectionLabel: Record<SectionId, string> = {
    kpis: t.dashboard.kpiCards,
    recentSales: t.dashboard.recentSalesSection,
    recentRepairs: t.dashboard.recentRepairsSection,
    quickActions: t.dashboard.quickActionsSection,
  };

  const moveSection = (from: SectionId, to: SectionId) => {
    if (from === to) return;
    setOrder((prev) => {
      const next = [...prev];
      const fromIndex = next.indexOf(from);
      const toIndex = next.indexOf(to);
      if (fromIndex < 0 || toIndex < 0) return prev;
      next.splice(fromIndex, 1);
      next.splice(toIndex, 0, from);
      return next;
    });
  };

  const renderSection = (section: SectionId) => {
    if (section === "kpis") {
      if (!visibility.showKpis) return null;
      return (
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 animate-fade-in">
          {cards.map((card) => (
            <div
              key={card.label}
              className="app-card"
            >
              <p className="text-xs font-medium" style={{ color: "var(--muted)" }}>{card.label}</p>
              <p className="mt-1.5 text-2xl font-bold tracking-tight">{card.value}</p>
              <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>{card.helper}</p>
            </div>
          ))}
        </section>
      );
    }

    if (section === "recentSales") {
      if (!visibility.showRecentSales) return null;
      return (
        <section className="app-card animate-fade-in">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="section-title">{t.dashboard.recentSales}</h2>
            <Link href="/pos" className="app-btn app-btn-secondary text-xs px-3 py-1.5">
              {t.dashboard.goToPOS}
            </Link>
          </div>
          {liveData.recentSales.length === 0 ? (
            <div className="empty-state">
              <p className="empty-title">{t.dashboard.noSales}</p>
            </div>
          ) : (
            <ul className="space-y-2 text-sm">
              {liveData.recentSales.map((sale) => (
                <li
                  key={sale.id}
                  className="rounded-lg border px-3 py-2.5 transition-colors duration-100 hover:bg-zinc-50"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div className="flex items-center justify-between">
                    <p className="font-semibold">{sale.invoiceNumber}</p>
                    <p className="font-medium">{formatMoney(sale.total)}</p>
                  </div>
                  <p className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>
                    {sale.customerName ?? t.dashboard.walkIn} • {sale.cashierName} • {new Date(sale.createdAt).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      );
    }

    if (section === "recentRepairs") {
      if (!visibility.showRecentRepairs) return null;
      return (
        <section className="app-card animate-fade-in">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="section-title">{t.dashboard.latestRepairs}</h2>
            <Link href="/repairs" className="app-btn app-btn-secondary text-xs px-3 py-1.5">
              {t.dashboard.openRepairsLink}
            </Link>
          </div>
          {liveData.recentRepairs.length === 0 ? (
            <div className="empty-state">
              <p className="empty-title">{t.dashboard.noRepairs}</p>
            </div>
          ) : (
            <ul className="space-y-2 text-sm">
              {liveData.recentRepairs.map((ticket) => (
                <li
                  key={ticket.id}
                  className="rounded-lg border px-3 py-2.5 transition-colors duration-100 hover:bg-zinc-50"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div className="flex items-center justify-between">
                    <p className="font-semibold">{ticket.ticketNumber}</p>
                    <span className="status-badge status-neutral text-xs">{ticket.status}</span>
                  </div>
                  <p className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>
                    {ticket.customerName} • {ticket.deviceName} • {new Date(ticket.createdAt).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      );
    }

    if (!visibility.showQuickActions) return null;
    return (
      <section className="app-card animate-fade-in">
        <h2 className="section-title mb-1">{t.dashboard.quickActions}</h2>
        <p className="mb-4 text-xs" style={{ color: "var(--muted)" }}>
          {t.dashboard.bestCategory}: {liveData.profitSummary.topCategory?.name ?? "—"} ({formatMoney(liveData.profitSummary.topCategory?.profit ?? 0)}) •{" "}
          {t.dashboard.bestBranch}: {liveData.profitSummary.topBranch?.name ?? "—"} ({formatMoney(liveData.profitSummary.topBranch?.profit ?? 0)})
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href="/pos" className="app-btn app-btn-primary">
            {t.dashboard.newSale}
          </Link>
          <Link href="/inventory" className="app-btn app-btn-secondary">
            {t.dashboard.manageInventory}
          </Link>
          <Link href="/purchasing" className="app-btn app-btn-secondary">
            {t.dashboard.createPO}
          </Link>
          {hasPermission(permissions, PERMISSIONS.reportsFinanceRead) ? (
            <Link href="/finance" className="app-btn app-btn-secondary">
              {t.dashboard.viewFinance}
            </Link>
          ) : null}
          {hasPermission(permissions, PERMISSIONS.settingsStoreRead) ? (
            <Link href="/settings" className="app-btn app-btn-secondary">
              {t.nav.settings}
            </Link>
          ) : null}
        </div>
      </section>
    );
  };

  return (
    <div className="space-y-6 p-5 sm:p-6">
      {/* Welcome banner for new / non-tech users */}
      {!welcomeDismissed && (
        <div
          className="relative overflow-hidden rounded-2xl border px-5 py-4"
          style={{
            borderColor: "color-mix(in srgb, var(--accent) 35%, transparent)",
            background: "color-mix(in srgb, var(--accent) 8%, var(--surface))",
          }}
        >
          <button
            onClick={dismissWelcome}
            aria-label={lang === "ar" ? "إغلاق" : "Close"}
            className="absolute end-3 top-3 flex h-7 w-7 items-center justify-center rounded-lg border opacity-60 hover:opacity-100 transition-opacity"
            style={{ borderColor: "var(--border)", background: "var(--surface-muted)" }}
          >
            <XIcon size={14} strokeWidth={2} aria-hidden />
          </button>
          <div className="flex items-start gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
              style={{ background: "color-mix(in srgb, var(--accent) 18%, transparent)", color: "var(--accent)" }}
            >
              <HelpCircle size={22} strokeWidth={2} aria-hidden />
            </div>
            <div>
              <h3 className="text-sm font-bold" style={{ color: "var(--foreground)" }}>
                {lang === "ar"
                  ? "مرحباً بك في برنامج إدارة المتجر"
                  : "Welcome to the Store Management System"}
              </h3>
              <p className="mt-1 text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>
                {lang === "ar"
                  ? "يمكنك إدارة المبيعات والمخزون والعملاء والإصلاحات والمالية كلها من مكان واحد. اضغط على زر"
                  : "Manage sales, inventory, customers, repairs, and finances all in one place. Press the"}
                {" "}
                <span
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-bold"
                  style={{ background: "color-mix(in srgb, var(--accent) 15%, transparent)", color: "var(--accent)" }}
                >
                  <HelpCircle size={11} strokeWidth={2} aria-hidden />
                  {lang === "ar" ? "؟" : "?"}
                </span>
                {" "}
                {lang === "ar"
                  ? "في الشريط العلوي لفتح دليل الاستخدام الكامل الذي يشرح كل قسم وكل زر."
                  : "button in the top bar to open the full user guide explaining every section and button."}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <a
                  href="/pos"
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-all hover:opacity-90 active:scale-95"
                  style={{ background: "var(--accent)", color: "var(--accent-foreground)" }}
                >
                  {lang === "ar" ? "ابدأ بالبيع ←" : "Start Selling →"}
                </a>
                <a
                  href="/inventory"
                  className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-all hover:opacity-90 active:scale-95"
                  style={{ borderColor: "var(--border)", background: "var(--surface-muted)", color: "var(--foreground)" }}
                >
                  {lang === "ar" ? "أضف منتجاتك" : "Add Products"}
                </a>
                <button
                  onClick={dismissWelcome}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-all hover:opacity-80"
                  style={{ color: "var(--muted)" }}
                >
                  {lang === "ar" ? "فهمت، شكراً" : "Got it, thanks"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hero panel */}
      <section
        className="rounded-2xl border p-5 sm:p-6"
        style={{
          background: "linear-gradient(135deg, color-mix(in srgb, var(--surface) 86%, var(--accent) 14%), var(--surface))",
          borderColor: "var(--border)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <label className="text-xs font-medium" style={{ color: "var(--muted)" }}>{t.dashboard.range}</label>
          <select
            value={rangeDays}
            onChange={(e) => setRangeDays(Number(e.target.value))}
            className="app-input"
            style={{ width: "auto" }}
          >
            {([7, 14, 30, 90] as const).map((d) => (
              <option key={d} value={d}>{d} {t.dashboard.days}</option>
            ))}
          </select>
          <label className="ms-2 text-xs font-medium" style={{ color: "var(--muted)" }}>{t.labels.branch}</label>
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="app-input"
            style={{ width: "auto" }}
          >
            <option value="">{t.dashboard.allBranches}</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>{branch.name}</option>
            ))}
          </select>
          <span className="ms-auto text-xs" style={{ color: "var(--muted)" }}>
            {insightLoading ? t.dashboard.updatingAnalytics : t.dashboard.liveReady}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_1fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
              {t.dashboard.todayPerformance}
            </p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight">{t.dashboard.title}</h1>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
              {t.dashboard.subtitle}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span
                className="rounded-full px-3 py-1 text-xs font-medium shadow-sm"
                style={{ background: "color-mix(in srgb, var(--surface) 90%, transparent)", border: "1px solid var(--border)" }}
              >
                {t.dashboard.revenueToday}: {formatMoney(liveData.salesToday)}
              </span>
              <span
                className="rounded-full px-3 py-1 text-xs font-medium shadow-sm"
                style={{ background: "color-mix(in srgb, var(--surface) 90%, transparent)", border: "1px solid var(--border)" }}
              >
                {t.dashboard.openRepairs}: {liveData.openRepairsCount}
              </span>
              <span
                className="rounded-full px-3 py-1 text-xs font-medium shadow-sm"
                style={{ background: "color-mix(in srgb, var(--surface) 90%, transparent)", border: "1px solid var(--border)" }}
              >
                {t.dashboard.lowStockAlerts}: {liveData.lowStockCount}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: t.dashboard.grossProfit, value: formatMoney(liveData.profitSummary.grossProfit), sub: `${liveData.profitSummary.grossMarginPct.toFixed(2)}% ${t.dashboard.margin}` },
              { label: t.dashboard.revenueWindow, value: formatMoney(liveData.profitSummary.revenue), sub: `${t.dashboard.cogs}: ${formatMoney(liveData.profitSummary.cogs)}` },
              { label: t.dashboard.topCategory, value: liveData.profitSummary.topCategory?.name ?? "—", sub: formatMoney(liveData.profitSummary.topCategory?.profit ?? 0) },
              { label: t.dashboard.topBranch, value: liveData.profitSummary.topBranch?.name ?? "—", sub: formatMoney(liveData.profitSummary.topBranch?.profit ?? 0) },
            ].map((mini) => (
              <div
                key={mini.label}
                className="rounded-xl border p-3"
                style={{
                  background: "color-mix(in srgb, var(--surface) 92%, transparent)",
                  borderColor: "var(--border)",
                  backdropFilter: "blur(4px)",
                }}
              >
                <p className="text-xs" style={{ color: "var(--muted)" }}>{mini.label}</p>
                <p className="mt-1 text-base font-bold leading-tight">{mini.value}</p>
                <p className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>{mini.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Charts row 1 */}
      <section className={`grid grid-cols-1 gap-4 xl:grid-cols-3 transition-opacity duration-300 ${insightLoading ? "opacity-70" : "opacity-100"}`}>
        <div className="app-card xl:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="section-title">{t.dashboard.salesTrend} ({rangeDays} {t.dashboard.days})</h3>
            {hasPermission(permissions, PERMISSIONS.reportsFinanceRead) ? (
              <Link href="/finance" className="app-btn app-btn-secondary text-xs px-2.5 py-1">
                {t.dashboard.openFinance}
              </Link>
            ) : null}
          </div>
          {insightLoading ? (
            <ChartSkeleton label={t.dashboard.salesTrend} />
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <AreaChart data={liveData.charts.salesTrend}>
                  <defs>
                    <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="date" tickFormatter={(v) => v.slice(5)} stroke="var(--muted)" tick={{ fontSize: 11 }} />
                  <YAxis stroke="var(--muted)" tick={{ fontSize: 11 }} />
                  <Tooltip {...CHART_TOOLTIP} formatter={(value) => formatMoney(Number(value ?? 0))} />
                  <Area type="monotone" dataKey="sales" stroke="#4f46e5" strokeWidth={2} fillOpacity={1} fill="url(#salesGradient)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
        <div className="app-card">
          <h3 className="section-title mb-3">{t.dashboard.paymentMix} ({rangeDays} {t.dashboard.days})</h3>
          {insightLoading ? (
            <ChartSkeleton label={t.dashboard.paymentMix} />
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <PieChart>
                  <Pie data={liveData.charts.paymentMix} dataKey="amount" nameKey="method" innerRadius={50} outerRadius={86}>
                    {liveData.charts.paymentMix.map((_, idx) => (
                      <Cell key={`cell-${idx}`} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip {...CHART_TOOLTIP} formatter={(value) => formatMoney(Number(value ?? 0))} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </section>

      {/* Charts row 2 */}
      <section className={`grid grid-cols-1 gap-4 xl:grid-cols-3 transition-opacity duration-300 ${insightLoading ? "opacity-70" : "opacity-100"}`}>
        <div className="app-card">
          <h3 className="section-title mb-3">{t.dashboard.quoteFunnel}</h3>
          {insightLoading ? (
            <ChartSkeleton label={t.dashboard.quoteFunnel} />
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <BarChart data={liveData.charts.quoteFunnel}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="status" stroke="var(--muted)" tick={{ fontSize: 10 }} />
                  <YAxis allowDecimals={false} stroke="var(--muted)" tick={{ fontSize: 11 }} />
                  <Tooltip {...CHART_TOOLTIP} />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]} fill="#06b6d4" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
        <div className="app-card xl:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="section-title">{t.dashboard.criticalLowStock}</h3>
            <Link href="/inventory" className="app-btn app-btn-secondary text-xs px-2.5 py-1">
              {t.dashboard.manageInventoryLink}
            </Link>
          </div>
          {insightLoading ? (
            <div className="space-y-2 pt-1">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 rounded-lg animate-pulse" style={{ background: "var(--surface-muted)" }} />
              ))}
            </div>
          ) : liveData.charts.lowStockItems.length === 0 ? (
            <div className="empty-state">
              <p className="empty-title">{t.dashboard.noLowStock}</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {liveData.charts.lowStockItems.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm"
                  style={{ borderColor: "var(--border)" }}
                >
                  <p>
                    <span className="font-semibold">{item.productName}</span>
                    <span className="ms-1.5 text-xs" style={{ color: "var(--muted)" }}>• {item.locationName}</span>
                  </p>
                  <p className="text-xs" style={{ color: "var(--muted)" }}>
                    {item.qty} {t.dashboard.inStock} / {t.dashboard.reorder} {item.reorderPoint}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Customize */}
      <section className="app-card">
        <div className="flex items-center justify-between">
          <h2 className="section-title">{t.dashboard.customizeDashboard}</h2>
          <button
            type="button"
            onClick={() => setShowCustomize((v) => !v)}
            className="app-btn app-btn-secondary text-xs"
          >
            {showCustomize ? t.dashboard.hideControls : t.dashboard.showControls}
          </button>
        </div>
        {showCustomize ? (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
              {(Object.entries(visibility) as Array<[keyof DashboardDefaults, boolean]>).map(([key, value]) => {
                const labels: Record<keyof DashboardDefaults, string> = {
                  showKpis: t.settings.showKpis,
                  showRecentSales: t.settings.showRecentSales,
                  showRecentRepairs: t.settings.showRecentRepairs,
                  showQuickActions: t.settings.showQuickActions,
                };
                return (
                  <label key={key} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={value}
                      onChange={(e) => setVisibility((prev) => ({ ...prev, [key]: e.target.checked }))}
                    />
                    {labels[key]}
                  </label>
                );
              })}
            </div>
            <div>
              <p className="mb-2 text-sm font-semibold">{t.dashboard.sectionOrder}</p>
              <ul className="space-y-2">
                {order.map((section) => (
                  <li
                    key={section}
                    draggable
                    onDragStart={() => setDragging(section)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragging) moveSection(dragging, section);
                      setDragging(null);
                    }}
                    className={`cursor-move rounded-lg border px-3 py-2.5 text-sm transition-all duration-100 ${
                      dragging === section ? "opacity-50 ring-2 ring-offset-1" : ""
                    }`}
                    style={{
                      background: "var(--surface-muted)",
                      borderColor: "var(--border)",
                      "--tw-ring-color": "var(--accent)",
                    } as React.CSSProperties}
                  >
                    <span className="me-2 opacity-50">⠿</span>
                    {sectionLabel[section]}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </section>

      {order.map((section) => (
        <div key={section}>{renderSection(section)}</div>
      ))}
    </div>
  );
}
