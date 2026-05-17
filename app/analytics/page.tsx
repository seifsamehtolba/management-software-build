"use client";

import { useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";
import { AppPage, Button, Card, PageHeader, SectionTitle, StatusBadge } from "@/components/ui/primitives";
import { parseResponseJson } from "@/lib/parseResponseJson";
import { RefreshCw, TrendingUp, Package, Users, Wrench, AlertTriangle } from "lucide-react";

type TrendDay = { date: string; revenue: number; count: number };
type TopProduct = { id: string; name: string; sku: string; category: string; revenue: number; qty: number; cost: number; margin: number; marginPct: number };
type ByCat = { name: string; revenue: number; qty: number };
type DeadStockItem = { id: string; name: string; sku: string; onHand: number; costPrice: number; totalValue: number; lastSoldAt: string | null };
type TopCustomer = { id: string; name: string; phone: string; totalSpent: number; orderCount: number; lastOrderAt: string };
type TechPerf = { id: string; name: string; buildsCompleted: number; repairsCompleted: number };
type ShiftVariance = { openedAt: string; closedAt: string | null; expectedCash: number; countedCash: number; variance: number; staffName: string };

type Analytics = {
  sales: {
    trend: TrendDay[];
    topProducts: TopProduct[];
    byCategory: ByCat[];
    marginSummary: { totalRevenue: number; totalCost: number; grossMargin: number; grossMarginPct: number };
  };
  inventory: { totalValue: number; totalSkus: number; deadStock: DeadStockItem[]; abcA: number; abcB: number; abcC: number };
  customers: { topCustomers: TopCustomer[]; repeatCount: number; oneTimeCount: number; lapsedCustomers: TopCustomer[] };
  operations: { techPerf: TechPerf[]; repairAging: { open: number; over7days: number; over14days: number; oldestDays: number }; shiftVariances: ShiftVariance[] };
};

type Tab = "sales" | "inventory" | "customers" | "operations";

function formatEGP(n: number) {
  return new Intl.NumberFormat("ar-EG", { style: "currency", currency: "EGP", maximumFractionDigits: 0 }).format(n);
}
function fmtDate(iso: string, lang: string) {
  return new Date(iso).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", { day: "2-digit", month: "short" });
}
function daysSince(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

function KpiCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ok" | "warn" | "bad" }) {
  const color = tone === "bad" ? "text-red-600" : tone === "warn" ? "text-orange-500" : undefined;
  return (
    <div className="app-card">
      <p className="text-xs" style={{ color: "var(--muted)" }}>{label}</p>
      <p className={`mt-1 text-xl font-bold ${color ?? ""}`} style={!color ? { color: "var(--accent)" } : {}}>{value}</p>
      {sub && <p className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>{sub}</p>}
    </div>
  );
}

function HBar({ label, value, max, fmt }: { label: string; value: number; max: number; fmt: (n: number) => string }) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 2;
  return (
    <div className="flex items-center gap-3">
      <p className="w-36 shrink-0 truncate text-xs" style={{ color: "var(--foreground)" }} title={label}>{label}</p>
      <div className="flex-1 rounded-full h-2.5 overflow-hidden" style={{ background: "var(--border)" }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: "var(--accent)" }} />
      </div>
      <p className="w-24 shrink-0 text-end text-xs font-semibold" style={{ color: "var(--foreground)" }}>{fmt(value)}</p>
    </div>
  );
}

function TrendChart({ days, lang }: { days: TrendDay[]; lang: string }) {
  const max = Math.max(...days.map((d) => d.revenue), 1);
  return (
    <div className="mt-3">
      <div className="flex items-end gap-0.5 h-24">
        {days.map((d) => {
          const pct = Math.max(2, (d.revenue / max) * 100);
          const isToday = d.date === new Date().toISOString().slice(0, 10);
          return (
            <div key={d.date} className="group relative flex-1 flex flex-col justify-end" title={`${fmtDate(d.date, lang)}: ${formatEGP(d.revenue)}`}>
              <div
                className="w-full rounded-t-sm transition-all"
                style={{
                  height: `${pct}%`,
                  background: isToday ? "var(--accent)" : "color-mix(in srgb, var(--accent) 45%, transparent)",
                }}
              />
              {/* Tooltip on hover */}
              <div
                className="pointer-events-none absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block z-10 rounded px-1.5 py-1 text-[10px] font-semibold whitespace-nowrap shadow"
                style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--foreground)" }}
              >
                {fmtDate(d.date, lang)}<br />{formatEGP(d.revenue)}
              </div>
            </div>
          );
        })}
      </div>
      {/* X-axis: show every 7th label */}
      <div className="flex mt-1">
        {days.map((d, i) => (
          <div key={d.date} className="flex-1 text-center">
            {i % 7 === 0 && <span className="text-[9px]" style={{ color: "var(--muted)" }}>{fmtDate(d.date, lang)}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const { t, lang } = useLang();
  const at = t.analytics as Record<string, string>;

  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("sales");

  const load = async () => {
    setLoading(true);
    const res = await fetch("/api/analytics");
    if (res.ok) {
      const d = await parseResponseJson<Analytics>(res);
      if (d) setData(d);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: "sales",      label: at.tabSales,      icon: TrendingUp },
    { key: "inventory",  label: at.tabInventory,  icon: Package },
    { key: "customers",  label: at.tabCustomers,  icon: Users },
    { key: "operations", label: at.tabOperations, icon: Wrench },
  ];

  return (
    <AppPage>
      <PageHeader
        title={at.title}
        subtitle={at.subtitle}
        actions={
          <Button variant="secondary" onClick={load}>
            <RefreshCw size={15} aria-hidden /> {at.refresh}
          </Button>
        }
      />

      {/* Tabs */}
      <div className="mb-4 flex gap-1 rounded-xl border p-1" style={{ background: "var(--surface-muted)", borderColor: "var(--border)" }}>
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-all"
            style={tab === key ? { background: "var(--accent)", color: "var(--accent-foreground)" } : { color: "var(--foreground)", background: "transparent" }}
          >
            <Icon size={14} aria-hidden />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {loading && <p className="py-16 text-center text-sm" style={{ color: "var(--muted)" }}>{at.loading}</p>}

      {!loading && data && (
        <>
          {/* ── SALES TAB ── */}
          {tab === "sales" && (
            <div className="flex flex-col gap-4">
              {/* KPI row */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <KpiCard label={at.kpiRevenue}   value={formatEGP(data.sales.marginSummary.totalRevenue)} sub={lang === "ar" ? "آخر 30 يوم" : "Last 30 days"} />
                <KpiCard label={at.kpiCost}       value={formatEGP(data.sales.marginSummary.totalCost)} />
                <KpiCard label={at.kpiMargin}     value={formatEGP(data.sales.marginSummary.grossMargin)} tone={data.sales.marginSummary.grossMargin < 0 ? "bad" : "ok"} />
                <KpiCard label={at.kpiMarginPct}  value={`${data.sales.marginSummary.grossMarginPct.toFixed(1)}%`} tone={data.sales.marginSummary.grossMarginPct < 20 ? "warn" : "ok"} />
              </div>

              {/* Trend chart */}
              <Card>
                <SectionTitle title={at.salesTrend} />
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  {lang === "ar" ? "الإيراد اليومي — آخر 30 يوماً (شريط اليوم مضاء)" : "Daily revenue — last 30 days (today highlighted)"}
                </p>
                <TrendChart days={data.sales.trend} lang={lang} />
              </Card>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {/* Top products */}
                <Card>
                  <SectionTitle title={at.topProducts} />
                  {data.sales.topProducts.length === 0 ? (
                    <p className="py-4 text-sm" style={{ color: "var(--muted)" }}>{at.noData}</p>
                  ) : (
                    <div className="flex flex-col gap-3 mt-2">
                      {data.sales.topProducts.map((p) => (
                        <div key={p.id}>
                          <div className="flex justify-between mb-0.5">
                            <span className="text-xs font-medium truncate max-w-[60%]" title={p.name}>{p.name}</span>
                            <span className="text-xs font-semibold" style={{ color: "var(--accent)" }}>{formatEGP(p.revenue)}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 rounded-full h-1.5 overflow-hidden" style={{ background: "var(--border)" }}>
                              <div className="h-full rounded-full" style={{ width: `${Math.max(2, (p.revenue / data.sales.topProducts[0].revenue) * 100)}%`, background: "var(--accent)" }} />
                            </div>
                            <span className="shrink-0 text-[10px]" style={{ color: "var(--muted)" }}>
                              {p.marginPct.toFixed(0)}% {lang === "ar" ? "هامش" : "margin"}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                {/* By category */}
                <Card>
                  <SectionTitle title={at.byCategory} />
                  {data.sales.byCategory.length === 0 ? (
                    <p className="py-4 text-sm" style={{ color: "var(--muted)" }}>{at.noData}</p>
                  ) : (
                    <div className="flex flex-col gap-2.5 mt-2">
                      {data.sales.byCategory.map((c) => (
                        <HBar key={c.name} label={c.name} value={c.revenue} max={data.sales.byCategory[0].revenue} fmt={formatEGP} />
                      ))}
                    </div>
                  )}
                </Card>
              </div>
            </div>
          )}

          {/* ── INVENTORY TAB ── */}
          {tab === "inventory" && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <KpiCard label={at.inventoryValue}  value={formatEGP(data.inventory.totalValue)} sub={lang === "ar" ? "تكلفة المخزون الكلية" : "Total stock cost"} />
                <KpiCard label={at.totalSkus}        value={String(data.inventory.totalSkus)} />
                <KpiCard label={at.deadStockCount}   value={String(data.inventory.deadStock.length)} tone={data.inventory.deadStock.length > 0 ? "warn" : "ok"} sub={lang === "ar" ? "لا مبيعات +60 يوم" : "No sales 60+ days"} />
                <KpiCard label={at.deadStockValue}   value={formatEGP(data.inventory.deadStock.reduce((s, d) => s + d.totalValue, 0))} tone="warn" sub={lang === "ar" ? "رأس مال راكد" : "Capital tied up"} />
              </div>

              {/* ABC analysis */}
              <Card>
                <SectionTitle title={at.abcTitle} />
                <p className="mb-3 text-xs" style={{ color: "var(--muted)" }}>
                  {lang === "ar"
                    ? "A = أفضل 20% منتجاً يولّد 80% من الإيراد — ركّز المخزون عليها. B = المنتجات المتوسطة. C = منتجات ذات دوران منخفض."
                    : "A = Top 20% of products generating 80% of revenue — keep well-stocked. B = Mid-tier. C = Low-turnover products."}
                </p>
                <div className="grid grid-cols-3 gap-4">
                  {[
                    { label: "A", count: data.inventory.abcA, color: "var(--accent)", desc: lang === "ar" ? "أفضل المنتجات" : "Best sellers" },
                    { label: "B", count: data.inventory.abcB, color: "#f59e0b",       desc: lang === "ar" ? "متوسطة الأداء" : "Mid performers" },
                    { label: "C", count: data.inventory.abcC, color: "var(--muted)",  desc: lang === "ar" ? "دوران منخفض" : "Low turnover" },
                  ].map(({ label, count, color, desc }) => (
                    <div key={label} className="rounded-lg border p-4 text-center" style={{ borderColor: "var(--border)" }}>
                      <p className="text-3xl font-black" style={{ color }}>{label}</p>
                      <p className="text-2xl font-bold mt-1">{count}</p>
                      <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>{desc}</p>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Dead stock table */}
              <Card>
                <div className="flex items-center gap-2 mb-3">
                  <SectionTitle title={at.deadStockTitle} />
                  {data.inventory.deadStock.length > 0 && (
                    <AlertTriangle size={14} className="text-orange-500" aria-hidden />
                  )}
                </div>
                {data.inventory.deadStock.length === 0 ? (
                  <p className="py-4 text-sm" style={{ color: "var(--muted)" }}>{lang === "ar" ? "لا توجد منتجات راكدة — ممتاز!" : "No dead stock — great!"}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ borderBottom: "1px solid var(--border)" }}>
                          {[at.colProduct, at.colOnHand, at.colCostPrice, at.colTotalValue, at.colLastSold].map((h) => (
                            <th key={h} className="px-3 py-2 text-start text-xs font-semibold" style={{ color: "var(--muted)" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.inventory.deadStock.map((item) => (
                          <tr key={item.id} style={{ borderBottom: "1px solid var(--border)" }}>
                            <td className="px-3 py-2.5">
                              <p className="font-medium">{item.name}</p>
                              <p className="text-xs" style={{ color: "var(--muted)" }}>{item.sku}</p>
                            </td>
                            <td className="px-3 py-2.5 font-semibold">{item.onHand}</td>
                            <td className="px-3 py-2.5" style={{ color: "var(--muted)" }}>{formatEGP(item.costPrice)}</td>
                            <td className="px-3 py-2.5 font-semibold text-orange-500">{formatEGP(item.totalValue)}</td>
                            <td className="px-3 py-2.5 text-xs" style={{ color: "var(--muted)" }}>
                              {item.lastSoldAt ? `${daysSince(item.lastSoldAt)} ${lang === "ar" ? "يوم" : "days ago"}` : (lang === "ar" ? "لم يُباع قط" : "Never sold")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>
          )}

          {/* ── CUSTOMERS TAB ── */}
          {tab === "customers" && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <KpiCard label={at.totalCustomers}  value={String(data.customers.repeatCount + data.customers.oneTimeCount)} />
                <KpiCard label={at.repeatCustomers} value={String(data.customers.repeatCount)}  sub={`${data.customers.repeatCount + data.customers.oneTimeCount > 0 ? ((data.customers.repeatCount / (data.customers.repeatCount + data.customers.oneTimeCount)) * 100).toFixed(0) : 0}%`} tone="ok" />
                <KpiCard label={at.oneTimeCustomers} value={String(data.customers.oneTimeCount)} />
                <KpiCard label={at.lapsedLabel}      value={String(data.customers.lapsedCustomers.length)} tone={data.customers.lapsedCustomers.length > 5 ? "warn" : "ok"} sub={lang === "ar" ? "لا شراء +90 يوم" : "No purchase 90+ days"} />
              </div>

              {/* Retention visual */}
              <Card>
                <SectionTitle title={at.retentionTitle} />
                {(() => {
                  const total = data.customers.repeatCount + data.customers.oneTimeCount;
                  const repeatPct = total > 0 ? (data.customers.repeatCount / total) * 100 : 0;
                  return (
                    <div className="mt-3">
                      <div className="flex h-6 overflow-hidden rounded-full" style={{ background: "var(--border)" }}>
                        <div className="h-full transition-all" style={{ width: `${repeatPct}%`, background: "var(--accent)" }} title={lang === "ar" ? "عملاء متكررون" : "Repeat"} />
                        <div className="h-full flex-1" style={{ background: "color-mix(in srgb, var(--accent) 20%, transparent)" }} title={lang === "ar" ? "مرة واحدة" : "One-time"} />
                      </div>
                      <div className="mt-2 flex gap-4 text-xs" style={{ color: "var(--muted)" }}>
                        <span>■ <span style={{ color: "var(--accent)" }}>{lang === "ar" ? "متكرر" : "Repeat"}</span> {repeatPct.toFixed(0)}%</span>
                        <span>■ {lang === "ar" ? "مرة واحدة" : "One-time"} {(100 - repeatPct).toFixed(0)}%</span>
                      </div>
                    </div>
                  );
                })()}
              </Card>

              {/* Top customers by LTV */}
              <Card>
                <SectionTitle title={at.topCustomersTitle} />
                {data.customers.topCustomers.length === 0 ? (
                  <p className="py-4 text-sm" style={{ color: "var(--muted)" }}>{at.noData}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ borderBottom: "1px solid var(--border)" }}>
                          {["#", at.colCustomer, at.colOrders, at.colTotalSpent, at.colLastOrder].map((h) => (
                            <th key={h} className="px-3 py-2 text-start text-xs font-semibold" style={{ color: "var(--muted)" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.customers.topCustomers.map((c, i) => (
                          <tr key={c.id} style={{ borderBottom: "1px solid var(--border)" }}>
                            <td className="px-3 py-2.5 text-xs font-bold" style={{ color: i < 3 ? "var(--accent)" : "var(--muted)" }}>#{i + 1}</td>
                            <td className="px-3 py-2.5">
                              <p className="font-semibold">{c.name}</p>
                              <p className="text-xs" style={{ color: "var(--muted)" }}>{c.phone}</p>
                            </td>
                            <td className="px-3 py-2.5">{c.orderCount}</td>
                            <td className="px-3 py-2.5 font-semibold" style={{ color: "var(--accent)" }}>{formatEGP(c.totalSpent)}</td>
                            <td className="px-3 py-2.5 text-xs" style={{ color: "var(--muted)" }}>{fmtDate(c.lastOrderAt, lang)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              {/* Lapsed customers */}
              {data.customers.lapsedCustomers.length > 0 && (
                <Card>
                  <div className="flex items-center gap-2 mb-1">
                    <SectionTitle title={at.lapsedTitle} />
                    <AlertTriangle size={14} className="text-orange-500" aria-hidden />
                  </div>
                  <p className="mb-3 text-xs" style={{ color: "var(--muted)" }}>
                    {lang === "ar" ? "هؤلاء العملاء لم يشتروا منذ أكثر من 90 يوماً — تواصل معهم بعرض خاص." : "These customers haven't bought in 90+ days — reach out with a special offer."}
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ borderBottom: "1px solid var(--border)" }}>
                          {[at.colCustomer, at.colTotalSpent, at.colLastOrder, at.colDaysGone].map((h) => (
                            <th key={h} className="px-3 py-2 text-start text-xs font-semibold" style={{ color: "var(--muted)" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.customers.lapsedCustomers.map((c) => (
                          <tr key={c.id} style={{ borderBottom: "1px solid var(--border)" }}>
                            <td className="px-3 py-2.5">
                              <p className="font-semibold">{c.name}</p>
                              <p className="text-xs" style={{ color: "var(--muted)" }}>{c.phone}</p>
                            </td>
                            <td className="px-3 py-2.5 font-semibold">{formatEGP(c.totalSpent)}</td>
                            <td className="px-3 py-2.5 text-xs" style={{ color: "var(--muted)" }}>{fmtDate(c.lastOrderAt, lang)}</td>
                            <td className="px-3 py-2.5">
                              <StatusBadge tone="warning">{daysSince(c.lastOrderAt)} {lang === "ar" ? "يوم" : "d"}</StatusBadge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </div>
          )}

          {/* ── OPERATIONS TAB ── */}
          {tab === "operations" && (
            <div className="flex flex-col gap-4">
              {/* Repair aging */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <KpiCard label={at.openRepairs}    value={String(data.operations.repairAging.open)} />
                <KpiCard label={at.over7days}      value={String(data.operations.repairAging.over7days)}  tone={data.operations.repairAging.over7days > 0 ? "warn" : "ok"} />
                <KpiCard label={at.over14days}     value={String(data.operations.repairAging.over14days)} tone={data.operations.repairAging.over14days > 0 ? "bad" : "ok"} />
                <KpiCard label={at.oldestTicket}   value={`${data.operations.repairAging.oldestDays} ${lang === "ar" ? "يوم" : "d"}`} tone={data.operations.repairAging.oldestDays > 14 ? "bad" : data.operations.repairAging.oldestDays > 7 ? "warn" : "ok"} />
              </div>

              {/* Technician performance */}
              <Card>
                <SectionTitle title={at.techPerfTitle} />
                {data.operations.techPerf.length === 0 ? (
                  <p className="py-4 text-sm" style={{ color: "var(--muted)" }}>{lang === "ar" ? "لا توجد بيانات فنيين بعد." : "No technician data yet."}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ borderBottom: "1px solid var(--border)" }}>
                          {[at.colTech, at.colBuilds, at.colRepairs, at.colTotal].map((h) => (
                            <th key={h} className="px-3 py-2 text-start text-xs font-semibold" style={{ color: "var(--muted)" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.operations.techPerf.map((tech) => (
                          <tr key={tech.id} style={{ borderBottom: "1px solid var(--border)" }}>
                            <td className="px-3 py-2.5 font-semibold">{tech.name}</td>
                            <td className="px-3 py-2.5">{tech.buildsCompleted}</td>
                            <td className="px-3 py-2.5">{tech.repairsCompleted}</td>
                            <td className="px-3 py-2.5 font-bold" style={{ color: "var(--accent)" }}>{tech.buildsCompleted + tech.repairsCompleted}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              {/* Shift variance history */}
              <Card>
                <SectionTitle title={at.shiftVarianceTitle} />
                <p className="mb-3 text-xs" style={{ color: "var(--muted)" }}>
                  {lang === "ar" ? "فروقات الصندوق في آخر 14 وردية مغلقة." : "Cash variance for the last 14 closed shifts."}
                </p>
                {data.operations.shiftVariances.length === 0 ? (
                  <p className="py-4 text-sm" style={{ color: "var(--muted)" }}>{lang === "ar" ? "لا توجد وردية مغلقة بعد." : "No closed shifts yet."}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ borderBottom: "1px solid var(--border)" }}>
                          {[at.colDate, at.colStaff, at.colExpected, at.colCounted, at.colVariance].map((h) => (
                            <th key={h} className="px-3 py-2 text-start text-xs font-semibold" style={{ color: "var(--muted)" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.operations.shiftVariances.map((s, i) => {
                          const diff = Math.abs(s.variance);
                          const tone = diff === 0 ? "success" : diff > 50 ? "danger" : "warning";
                          return (
                            <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                              <td className="px-3 py-2.5 text-xs" style={{ color: "var(--muted)" }}>{fmtDate(s.openedAt, lang)}</td>
                              <td className="px-3 py-2.5">{s.staffName}</td>
                              <td className="px-3 py-2.5">{formatEGP(s.expectedCash)}</td>
                              <td className="px-3 py-2.5">{formatEGP(s.countedCash)}</td>
                              <td className="px-3 py-2.5">
                                <StatusBadge tone={tone}>
                                  {s.variance === 0 ? "✓" : s.variance > 0 ? `+${formatEGP(s.variance)}` : formatEGP(s.variance)}
                                </StatusBadge>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>
          )}
        </>
      )}
    </AppPage>
  );
}
