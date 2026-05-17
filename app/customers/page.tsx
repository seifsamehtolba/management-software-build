"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppPage, Button, Card, EmptyState, Input, PageHeader, SectionTitle } from "@/components/ui/primitives";
import { SuggestInput, type SuggestItem } from "@/components/ui/SuggestInput";
import { errorMessageFromJson, parseResponseJson } from "@/lib/parseResponseJson";
import { useLang } from "@/lib/i18n";

type CustomerRow = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  notes: string | null;
  isBlacklisted: boolean;
  creditBalance: number;
  loyaltyPoints: number;
  type: "REGULAR" | "VIP" | "WHOLESALE";
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  updatedAt: string;
  _count?: {
    sales: number;
    quotes: number;
    repairTickets: number;
  };
};

type CustomersResponse = {
  rows: CustomerRow[];
  page: number;
  pageSize: number;
  totalCount: number;
  pageCount: number;
};

type CustomerForm = {
  name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  type: "REGULAR" | "VIP" | "WHOLESALE";
};

const defaultForm: CustomerForm = {
  name: "",
  phone: "",
  email: "",
  address: "",
  notes: "",
  type: "REGULAR",
};

export default function CustomersPage() {
  const { t, lang } = useLang();
  const tc = t.customers;
  const router = useRouter();
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [debtors, setDebtors] = useState<CustomerRow[]>([]);
  const [debtorsLoading, setDebtorsLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"" | "REGULAR" | "VIP" | "WHOLESALE">("");
  const [includeBlacklisted, setIncludeBlacklisted] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [pageCount, setPageCount] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CustomerForm>(defaultForm);
  const [saving, setSaving] = useState(false);

  const pageRef = useRef(page);
  pageRef.current = page;

  const fmt = (n: number) =>
    new Intl.NumberFormat(lang === "ar" ? "ar-EG" : "en-EG", { style: "currency", currency: "EGP" }).format(n);

  const loadDebtors = useCallback(async () => {
    setDebtorsLoading(true);
    try {
      const params = new URLSearchParams({ inDebt: "1", includeBlacklisted: "1", pageSize: "10" });
      const res = await fetch(`/api/customers?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await parseResponseJson<{ rows: CustomerRow[] }>(res);
      const sorted = (data?.rows ?? []).sort((a, b) => a.creditBalance - b.creditBalance);
      setDebtors(sorted);
    } finally {
      setDebtorsLoading(false);
    }
  }, []);

  useEffect(() => { void loadDebtors(); }, [loadDebtors]);

  const load = useCallback(
    async (q?: string, nextPage?: number) => {
      const targetPage = nextPage ?? pageRef.current;
      setLoading(true);
      const params = new URLSearchParams();
      if (q?.trim()) params.set("q", q.trim());
      if (typeFilter) params.set("type", typeFilter);
      if (includeBlacklisted) params.set("includeBlacklisted", "1");
      params.set("page", String(targetPage));
      params.set("pageSize", String(pageSize));
      const res = await fetch(`/api/customers?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) {
        setLoading(false);
        return;
      }
      const data = await parseResponseJson<CustomersResponse>(res);
      if (!data) {
        setLoading(false);
        return;
      }
      setRows(data.rows);
      setPage(data.page);
      setPageCount(data.pageCount);
      setTotalCount(data.totalCount);
      setLoading(false);
    },
    [includeBlacklisted, pageSize, typeFilter],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      void load(query.trim() || undefined, 1);
    }, 350);
    return () => clearTimeout(timer);
  }, [query, typeFilter, includeBlacklisted, load]);

  const loadCustomerSuggest = useCallback(
    async (q: string, signal: AbortSignal): Promise<SuggestItem[]> => {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (typeFilter) params.set("type", typeFilter);
      if (includeBlacklisted) params.set("includeBlacklisted", "1");
      params.set("page", "1");
      params.set("pageSize", "12");
      const res = await fetch(`/api/customers?${params.toString()}`, { signal, cache: "no-store" });
      if (!res.ok) return [];
      const data = await parseResponseJson<CustomersResponse>(res);
      if (!data) return [];
      return data.rows.map((r) => ({
        id: r.id,
        label: r.name,
        description: [r.phone, r.email].filter(Boolean).join(" · "),
        data: r,
      }));
    },
    [typeFilter, includeBlacklisted],
  );

  const kpis = useMemo(() => {
    const highRisk = rows.filter((row) => row.riskLevel === "HIGH").length;
    const totalCredit = rows.reduce((sum, row) => sum + Number(row.creditBalance), 0);
    const vipCount = rows.filter((row) => row.type === "VIP").length;
    return { highRisk, totalCredit, vipCount };
  }, [rows]);

  const openCreate = () => {
    setEditingId(null);
    setForm(defaultForm);
    setStatus("");
  };

  const openEdit = (row: CustomerRow) => {
    setEditingId(row.id);
    setForm({
      name: row.name,
      phone: row.phone,
      email: row.email ?? "",
      address: row.address ?? "",
      notes: row.notes ?? "",
      type: row.type,
    });
    setStatus("");
  };

  const saveCustomer = async () => {
    if (!form.name.trim() || !form.phone.trim()) {
      setStatus(tc.namePhoneRequired);
      return;
    }
    setSaving(true);
    setStatus("");
    try {
      const res = await fetch(editingId ? `/api/customers/${editingId}` : "/api/customers", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await parseResponseJson<{ message?: string }>(res);
      if (!res.ok) {
        setStatus(errorMessageFromJson(data, t.errors.generic));
        return;
      }
      setStatus(editingId ? tc.updateCustomer : tc.createCustomer);
      setEditingId(null);
      setForm(defaultForm);
      await load(query, page);
    } finally {
      setSaving(false);
    }
  };

  const blacklistCustomer = async (id: string) => {
    const ok = confirm(tc.blacklist + "?");
    if (!ok) return;
    const res = await fetch(`/api/customers/${id}`, { method: "DELETE" });
    if (!res.ok) return;
    await load(query, page);
  };

  const toggleBlacklist = async (row: CustomerRow) => {
    const res = await fetch(`/api/customers/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isBlacklisted: !row.isBlacklisted }),
    });
    if (!res.ok) return;
    await load(query, page);
  };

  const exportCsv = () => {
    const header = [
      "Name",
      "Phone",
      "Type",
      "CreditBalance",
      "LoyaltyPoints",
      "RiskLevel",
      "SalesCount",
      "QuotesCount",
      "RepairsCount",
      "Blacklisted",
    ];
    const lines = rows.map((r) =>
      [
        r.name,
        r.phone,
        r.type,
        r.creditBalance.toFixed(2),
        String(r.loyaltyPoints),
        r.riskLevel,
        String(r._count?.sales ?? 0),
        String(r._count?.quotes ?? 0),
        String(r._count?.repairTickets ?? 0),
        r.isBlacklisted ? "yes" : "no",
      ]
        .map((cell) => `"${String(cell).replaceAll('"', '""')}"`)
        .join(","),
    );
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "customers-export.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppPage>
      <PageHeader title={tc.title} subtitle={tc.subtitle} />
      <Card className="mb-4">
        <SectionTitle title={tc.crmControls} subtitle={tc.crmSubtitle} />
        <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-4">
          <div className="app-card px-3 py-2 text-sm">
            <span style={{ color: "var(--muted)" }}>{tc.visibleCustomers}</span>
            <p className="font-semibold">{totalCount}</p>
          </div>
          <div className="app-card px-3 py-2 text-sm">
            <span style={{ color: "var(--muted)" }}>{tc.vipInPage}</span>
            <p className="font-semibold">{kpis.vipCount}</p>
          </div>
          <div className="app-card px-3 py-2 text-sm">
            <span style={{ color: "var(--muted)" }}>{tc.highRisk}</span>
            <p className="font-semibold">{kpis.highRisk}</p>
          </div>
          <div className="app-card px-3 py-2 text-sm">
            <span style={{ color: "var(--muted)" }}>{tc.creditExposure}</span>
            <p className="font-semibold">{fmt(kpis.totalCredit)}</p>
          </div>
        </div>
        <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-[2fr_1fr_auto_auto_auto]">
          <SuggestInput
            value={query}
            onChange={setQuery}
            loadSuggestions={loadCustomerSuggest}
            minChars={2}
            onPick={(item) => {
              const row = item.data as CustomerRow;
              router.push(`/customers/${row.id}`);
            }}
            placeholder={tc.searchPlaceholder}
          />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as "" | "REGULAR" | "VIP" | "WHOLESALE")}
            className="app-input"
          >
            <option value="">{tc.allTypes}</option>
            <option value="REGULAR">{tc.regular}</option>
            <option value="VIP">{tc.vip}</option>
            <option value="WHOLESALE">{tc.wholesale}</option>
          </select>
          <Button type="button" variant="secondary" onClick={() => void load(query, 1)}>
            {tc.searchFilter}
          </Button>
          <Button type="button" variant="secondary" onClick={openCreate}>
            {tc.newCustomer}
          </Button>
          <Button type="button" variant="secondary" onClick={exportCsv}>
            {tc.exportCsv}
          </Button>
        </div>
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeBlacklisted}
            onChange={(e) => setIncludeBlacklisted(e.target.checked)}
          />
          {tc.includeBlacklisted}
        </label>

        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
          <Input
            value={form.name}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            placeholder={tc.namePlaceholder}
          />
          <Input
            value={form.phone}
            onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
            placeholder={tc.phonePlaceholder}
          />
          <Input
            value={form.email}
            onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
            placeholder={tc.emailPlaceholder}
          />
          <Input
            value={form.address}
            onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
            placeholder={tc.addressPlaceholder}
          />
          <select
            value={form.type}
            onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value as CustomerForm["type"] }))}
            className="app-input"
          >
            <option value="REGULAR">{tc.regular}</option>
            <option value="VIP">{tc.vip}</option>
            <option value="WHOLESALE">{tc.wholesale}</option>
          </select>
          <Input
            value={form.notes}
            onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
            placeholder={tc.notesPlaceholder}
          />
        </div>
        <div className="mt-2 flex gap-2">
          <Button type="button" onClick={() => void saveCustomer()} disabled={saving}>
            {saving ? t.actions.saving : editingId ? tc.updateCustomer : tc.createCustomer}
          </Button>
          {editingId ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setEditingId(null);
                setForm(defaultForm);
              }}
            >
              {tc.cancelEdit}
            </Button>
          ) : null}
        </div>
        {status ? <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>{status}</p> : null}
      </Card>

      <Card className="mb-4">
        <div className="mb-3 flex items-center justify-between">
          <SectionTitle title={tc.inDebtTitle} subtitle={tc.inDebtSubtitle} />
          <Link href="/debts" className="app-btn app-btn-secondary py-1 text-xs">
            {tc.viewAllDebts}
          </Link>
        </div>
        {debtorsLoading ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>{t.actions.loading}</p>
        ) : debtors.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>{tc.noDebtors}</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[400px] border-collapse text-sm">
                <thead>
                  <tr className="border-b text-start" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                    <th className="px-2 py-2 font-medium text-start">{tc.colName}</th>
                    <th className="px-2 py-2 font-medium text-start">{tc.colPhone}</th>
                    <th className="px-2 py-2 font-medium text-start">{tc.colCredit}</th>
                  </tr>
                </thead>
                <tbody>
                  {debtors.slice(0, 5).map((d) => (
                    <tr key={d.id} className="border-b" style={{ borderColor: "var(--border)" }}>
                      <td className="px-2 py-2 font-medium">
                        <Link href={`/customers/${d.id}`} className="hover:underline">{d.name}</Link>
                      </td>
                      <td className="px-2 py-2" style={{ color: "var(--muted)" }}>{d.phone}</td>
                      <td className="px-2 py-2 font-semibold" style={{ color: "var(--danger, #dc2626)" }}>
                        {fmt(d.creditBalance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
              {tc.totalDebt}: <strong>{fmt(debtors.reduce((s, d) => s + Math.abs(d.creditBalance), 0))}</strong>
              {debtors.length > 5 ? ` · ${debtors.length} ${t.debts.debtorCount}` : null}
            </p>
          </>
        )}
      </Card>

      <Card>
        <SectionTitle
          title={tc.customerDirectory}
          subtitle={`${rows.length} ${tc.rowsLoaded}`}
        />
        {loading ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            {t.actions.loading}
          </p>
        ) : null}
        {!loading && rows.length === 0 ? (
          <EmptyState title={tc.noCustomers} subtitle={tc.noCustomersHint} />
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1150px] border-collapse text-sm">
            <thead>
              <tr className="border-b text-start" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                <th className="px-2 py-2 font-medium text-start">{tc.colName}</th>
                <th className="px-2 py-2 font-medium text-start">{tc.colPhone}</th>
                <th className="px-2 py-2 font-medium text-start">{tc.colType}</th>
                <th className="px-2 py-2 font-medium text-start">{tc.colCredit}</th>
                <th className="px-2 py-2 font-medium text-start">{tc.colPoints}</th>
                <th className="px-2 py-2 font-medium text-start">{tc.colRisk}</th>
                <th className="px-2 py-2 font-medium text-start">{tc.colSnapshot}</th>
                <th className="px-2 py-2 font-medium text-start">{tc.colFlags}</th>
                <th className="px-2 py-2 font-medium text-start">{tc.colProfile}</th>
                <th className="px-2 py-2 font-medium text-start">{tc.colActions}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b" style={{ borderColor: "var(--border)" }}>
                  <td className="px-2 py-2">{row.name}</td>
                  <td className="px-2 py-2">{row.phone}</td>
                  <td className="px-2 py-2">{row.type}</td>
                  <td className="px-2 py-2">{fmt(Number(row.creditBalance))}</td>
                  <td className="px-2 py-2">{row.loyaltyPoints}</td>
                  <td className="px-2 py-2">
                    <span
                      className={`rounded px-2 py-1 text-xs ${
                        row.riskLevel === "HIGH"
                          ? "bg-red-100 text-red-700"
                          : row.riskLevel === "MEDIUM"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-emerald-100 text-emerald-700"
                      }`}
                    >
                      {row.riskLevel}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-xs" style={{ color: "var(--muted)" }}>
                    {row._count
                      ? `${row._count.sales} • ${row._count.quotes} • ${row._count.repairTickets}`
                      : "—"}
                  </td>
                  <td className="px-2 py-2 text-xs">
                    {row.isBlacklisted ? (
                      <span className="rounded bg-red-100 px-2 py-1 text-red-700">{tc.blacklisted}</span>
                    ) : (
                      <span className="rounded bg-emerald-100 px-2 py-1 text-emerald-700">{tc.active}</span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <Link href={`/customers/${row.id}`} className="app-btn app-btn-secondary py-1 text-xs">
                      {tc.open}
                    </Link>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(row)}
                        className="app-btn app-btn-secondary py-1 text-xs"
                      >
                        {tc.edit}
                      </button>
                      <button
                        type="button"
                        onClick={() => void toggleBlacklist(row)}
                        className="app-btn app-btn-secondary py-1 text-xs"
                      >
                        {row.isBlacklisted ? tc.unblacklist : tc.blacklist}
                      </button>
                      {!row.isBlacklisted ? (
                        <button
                          type="button"
                          onClick={() => void blacklistCustomer(row.id)}
                          className="app-btn app-btn-secondary py-1 text-xs"
                        >
                          {tc.softDelete}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex items-center justify-between text-sm">
          <p style={{ color: "var(--muted)" }}>
            {tc.pageOf} {page} {tc.of} {pageCount}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => void load(query, Math.max(1, page - 1))}
              disabled={page <= 1}
            >
              {tc.prevPage}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void load(query, Math.min(pageCount, page + 1))}
              disabled={page >= pageCount}
            >
              {tc.nextPage}
            </Button>
          </div>
        </div>
      </Card>
    </AppPage>
  );
}
