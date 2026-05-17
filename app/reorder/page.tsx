"use client";

import { useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";
import { AppPage, Button, Card, PageHeader, SectionTitle, StatusBadge } from "@/components/ui/primitives";
import { parseResponseJson } from "@/lib/parseResponseJson";
import { RefreshCw, ShoppingCart, AlertTriangle, TrendingDown } from "lucide-react";

type ReorderRow = {
  productId: string;
  productName: string;
  sku: string;
  locationName: string;
  onHand: number;
  reorderPoint: number;
  sold45Days: number;
  dailyRunRate: number;
  recommendedQty: number;
  gapQty: number;
  estimatedBuyCost: number;
  estimatedRevenue: number;
};

type Supplier = { id: string; name: string };

function formatEGP(n: number) {
  return new Intl.NumberFormat("ar-EG", { style: "currency", currency: "EGP", maximumFractionDigits: 0 }).format(n);
}

export default function ReorderPage() {
  const { t, lang } = useLang();
  const rt = t.reorder as Record<string, string>;

  const [rows, setRows] = useState<ReorderRow[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [supplierId, setSupplierId] = useState("");
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setMsg(""); setError("");
    const [rowsRes, suppRes] = await Promise.all([
      fetch("/api/reorder-recommendations"),
      fetch("/api/suppliers"),
    ]);
    if (rowsRes.ok) {
      const data = await parseResponseJson<{ rows: ReorderRow[] }>(rowsRes);
      if (data) setRows(data.rows);
    }
    if (suppRes.ok) {
      const data = await parseResponseJson<{ suppliers: Supplier[] }>(suppRes);
      if (data) setSuppliers(data.suppliers);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const toggleRow = (productId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(rows.map((r) => r.productId)));
  const deselectAll = () => setSelected(new Set());

  const createPO = async () => {
    if (!supplierId) { setError(lang === "ar" ? "اختر المورد أولاً" : "Select a supplier first"); return; }
    if (selected.size === 0) { setError(lang === "ar" ? "اختر منتجاً واحداً على الأقل" : "Select at least one product"); return; }
    setCreating(true); setMsg(""); setError("");
    const items = rows
      .filter((r) => selected.has(r.productId))
      .map((r) => ({ productId: r.productId, qty: r.gapQty, unitCost: r.estimatedBuyCost / r.gapQty }));
    const res = await fetch("/api/purchase-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ supplierId, items }),
    });
    setCreating(false);
    if (res.ok) { setMsg(rt.poCreated); setSelected(new Set()); }
    else {
      const d = await res.json().catch(() => ({}));
      setError((d as { message?: string }).message ?? t.errors.generic);
    }
  };

  const totalCost = rows.filter((r) => selected.has(r.productId)).reduce((sum, r) => sum + r.estimatedBuyCost, 0);
  const urgentRows = rows.filter((r) => r.onHand === 0);
  const normalRows = rows.filter((r) => r.onHand > 0);

  return (
    <AppPage>
      <PageHeader
        title={rt.title}
        subtitle={rt.subtitle}
        actions={
          <Button variant="secondary" onClick={load}>
            <RefreshCw size={15} aria-hidden /> {rt.refresh}
          </Button>
        }
      />

      {msg && <div className="mb-4 rounded-lg bg-green-50 px-4 py-2 text-sm text-green-700">{msg}</div>}
      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {/* Summary cards */}
      {!loading && rows.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="app-card">
            <p className="text-xs" style={{ color: "var(--muted)" }}>{lang === "ar" ? "إجمالي المنتجات" : "Total Products"}</p>
            <p className="mt-1 text-2xl font-bold">{rows.length}</p>
          </div>
          <div className="app-card">
            <p className="text-xs" style={{ color: "var(--muted)" }}>{lang === "ar" ? "نفدت من المخزون" : "Out of Stock"}</p>
            <p className="mt-1 text-2xl font-bold text-red-600">{urgentRows.length}</p>
          </div>
          <div className="app-card">
            <p className="text-xs" style={{ color: "var(--muted)" }}>{rt.selectedItems}</p>
            <p className="mt-1 text-2xl font-bold" style={{ color: "var(--accent)" }}>{selected.size}</p>
          </div>
          <div className="app-card">
            <p className="text-xs" style={{ color: "var(--muted)" }}>{rt.totalEstCost}</p>
            <p className="mt-1 text-xl font-bold">{formatEGP(totalCost)}</p>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {/* Action bar */}
        {!loading && rows.length > 0 && (
          <Card>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" onClick={selectAll}>{rt.selectAll}</Button>
              <Button variant="ghost" onClick={deselectAll}>{rt.deselectAll}</Button>
              <div className="flex-1" />
              <div>
                <label className="me-2 text-xs font-medium" style={{ color: "var(--muted)" }}>{rt.selectSupplier}</label>
                <select className="app-input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                  <option value="">—</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <Button onClick={createPO} disabled={creating || selected.size === 0}>
                <ShoppingCart size={15} aria-hidden />
                {creating ? rt.creating : rt.createPoForSelected}
              </Button>
            </div>
          </Card>
        )}

        {/* Products table */}
        <Card>
          <SectionTitle title={rt.title} />
          {loading ? (
            <p className="py-8 text-center text-sm" style={{ color: "var(--muted)" }}>{rt.loading}</p>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center">
              <TrendingDown size={40} strokeWidth={1.5} className="mx-auto mb-3" style={{ color: "var(--muted)" }} />
              <p className="text-sm font-medium" style={{ color: "var(--muted)" }}>{rt.noReorders}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <th className="px-3 py-2 text-start w-10">
                      <input type="checkbox"
                        checked={selected.size === rows.length && rows.length > 0}
                        onChange={(e) => e.target.checked ? selectAll() : deselectAll()} />
                    </th>
                    {[rt.colProduct, rt.colLocation, rt.colOnHand, rt.colReorderPoint, rt.colSold45, rt.colRecommended, rt.colEstCost, ""].map((h) => (
                      <th key={h} className="px-3 py-2 text-start text-xs font-semibold" style={{ color: "var(--muted)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...urgentRows, ...normalRows].map((row) => {
                    const isUrgent = row.onHand === 0;
                    const isSelected = selected.has(row.productId);
                    return (
                      <tr
                        key={row.productId}
                        className="cursor-pointer hover:bg-[color-mix(in_srgb,var(--accent)_4%,transparent)]"
                        style={{
                          borderBottom: "1px solid var(--border)",
                          background: isSelected ? "color-mix(in srgb, var(--accent) 6%, transparent)" : undefined,
                        }}
                        onClick={() => toggleRow(row.productId)}
                      >
                        <td className="px-3 py-2.5">
                          <input type="checkbox" checked={isSelected} onChange={() => toggleRow(row.productId)} onClick={(e) => e.stopPropagation()} />
                        </td>
                        <td className="px-3 py-2.5">
                          <p className="font-medium">{row.productName}</p>
                          <p className="text-xs" style={{ color: "var(--muted)" }}>{row.sku}</p>
                        </td>
                        <td className="px-3 py-2.5 text-xs" style={{ color: "var(--muted)" }}>{row.locationName}</td>
                        <td className="px-3 py-2.5">
                          <span className={`font-bold ${row.onHand === 0 ? "text-red-600" : row.onHand <= row.reorderPoint ? "text-orange-500" : ""}`}>
                            {row.onHand}
                          </span>
                        </td>
                        <td className="px-3 py-2.5" style={{ color: "var(--muted)" }}>{row.reorderPoint}</td>
                        <td className="px-3 py-2.5">{row.sold45Days}</td>
                        <td className="px-3 py-2.5">
                          <span className="font-semibold" style={{ color: "var(--accent)" }}>{row.gapQty}</span>
                          <span className="text-xs" style={{ color: "var(--muted)" }}> / {row.recommendedQty}</span>
                        </td>
                        <td className="px-3 py-2.5 font-semibold">{formatEGP(row.estimatedBuyCost)}</td>
                        <td className="px-3 py-2.5">
                          <StatusBadge tone={isUrgent ? "danger" : "warning"}>
                            {isUrgent ? rt.urgentBadge : rt.normalBadge}
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
    </AppPage>
  );
}
