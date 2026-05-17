"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";
import { AppPage, Button, Card, Input, PageHeader, SectionTitle, StatusBadge } from "@/components/ui/primitives";
import { parseResponseJson } from "@/lib/parseResponseJson";
import { Plus, RefreshCw, Search, Cpu, User, Wrench } from "lucide-react";

type BuildPart = {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  quantity: number;
  unitCost: number;
  note: string | null;
};

type BuildOrder = {
  id: string;
  buildNumber: string;
  title: string;
  status: string;
  customer: { id: string; name: string; phone: string };
  technician: { id: string; name: string } | null;
  estimatedCost: number | null;
  finalCost: number | null;
  parts: BuildPart[];
  convertedSaleId: string | null;
  createdAt: string;
};

type Customer = { id: string; name: string; phone: string };
type Product = { id: string; name: string; sku: string; costPrice: number; sellPrice: number };
type TechUser = { id: string; name: string };

const STATUS_COLORS: Record<string, "neutral" | "success" | "warning" | "danger"> = {
  PLANNING: "neutral",
  SOURCING: "warning",
  ASSEMBLING: "warning",
  TESTING: "warning",
  READY: "success",
  DELIVERED: "success",
  CANCELLED: "danger",
};

function formatEGP(n: number) {
  return new Intl.NumberFormat("ar-EG", { style: "currency", currency: "EGP", maximumFractionDigits: 0 }).format(n);
}

export default function BuildsPage() {
  const { t, lang } = useLang();
  const bt = t.builds as Record<string, string>;
  const [builds, setBuilds] = useState<BuildOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  // Create form state
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [techUsers, setTechUsers] = useState<TechUser[]>([]);
  const [formTitle, setFormTitle] = useState("");
  const [formCustomerId, setFormCustomerId] = useState("");
  const [formTechnicianId, setFormTechnicianId] = useState("");
  const [formEstimatedCost, setFormEstimatedCost] = useState("");
  const [formLaborCost, setFormLaborCost] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formParts, setFormParts] = useState<Array<{ productId: string; quantity: number; unitCost: number; note: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    const res = await fetch(`/api/builds${search ? `?search=${encodeURIComponent(search)}` : ""}`);
    if (res.ok) {
      const data = await parseResponseJson<BuildOrder[]>(res);
      if (data) setBuilds(data);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const loadFormData = async () => {
    const [custRes, prodRes, usersRes] = await Promise.all([
      fetch("/api/customers?limit=200"),
      fetch("/api/products?limit=500"),
      fetch("/api/users"),
    ]);
    if (custRes.ok) {
      const d = await parseResponseJson<{ customers: Customer[] }>(custRes);
      if (d) setCustomers(d.customers);
    }
    if (prodRes.ok) {
      const d = await parseResponseJson<{ products: Product[] }>(prodRes);
      if (d) setProducts(d.products);
    }
    if (usersRes.ok) {
      const d = await parseResponseJson<{ users: TechUser[] }>(usersRes);
      if (d) setTechUsers(d.users);
    }
  };

  const openCreate = () => {
    setShowCreate(true);
    loadFormData();
  };

  const addPart = () => {
    setFormParts((prev) => [...prev, { productId: "", quantity: 1, unitCost: 0, note: "" }]);
  };

  const removePart = (i: number) => {
    setFormParts((prev) => prev.filter((_, idx) => idx !== i));
  };

  const updatePart = (i: number, field: string, value: string | number) => {
    setFormParts((prev) => prev.map((p, idx) => (idx === i ? { ...p, [field]: value } : p)));
  };

  const onProductSelect = (i: number, productId: string) => {
    const prod = products.find((p) => p.id === productId);
    setFormParts((prev) =>
      prev.map((p, idx) =>
        idx === i ? { ...p, productId, unitCost: prod ? prod.costPrice : 0 } : p,
      ),
    );
  };

  const handleCreate = async () => {
    setError("");
    if (!formTitle.trim()) { setError(bt.titleRequired); return; }
    if (!formCustomerId) { setError(bt.customerRequired); return; }
    setSaving(true);
    const res = await fetch("/api/builds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: formTitle,
        customerId: formCustomerId,
        technicianId: formTechnicianId || undefined,
        estimatedCost: formEstimatedCost ? Number(formEstimatedCost) : undefined,
        laborCost: formLaborCost ? Number(formLaborCost) : undefined,
        notes: formNotes || undefined,
        parts: formParts.filter((p) => p.productId),
      }),
    });
    setSaving(false);
    if (res.ok) {
      setShowCreate(false);
      setFormTitle(""); setFormCustomerId(""); setFormTechnicianId("");
      setFormEstimatedCost(""); setFormLaborCost(""); setFormNotes("");
      setFormParts([]);
      load();
    } else {
      const d = await res.json().catch(() => ({}));
      setError((d as { message?: string }).message ?? t.errors.generic);
    }
  };

  const statusLabel = (s: string) => {
    const map: Record<string, string> = {
      PLANNING: bt.statusPlanning,
      SOURCING: bt.statusSourcing,
      ASSEMBLING: bt.statusAssembling,
      TESTING: bt.statusTesting,
      READY: bt.statusReady,
      DELIVERED: bt.statusDelivered,
      CANCELLED: bt.statusCancelled,
    };
    return map[s] ?? s;
  };

  const partsCost = (parts: BuildPart[]) =>
    parts.reduce((sum, p) => sum + p.unitCost * p.quantity, 0);

  return (
    <AppPage>
      <PageHeader
        title={bt.title}
        subtitle={bt.subtitle}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={load}>
              <RefreshCw size={15} aria-hidden /> {bt.refresh}
            </Button>
            <Button onClick={openCreate}>
              <Plus size={15} aria-hidden /> {bt.newBuild}
            </Button>
          </div>
        }
      />

      {/* Search */}
      <Card className="mb-4">
        <div className="flex items-center gap-2">
          <Search size={16} style={{ color: "var(--muted)" }} aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
            placeholder={bt.searchPlaceholder}
            className="flex-1"
          />
          <Button variant="secondary" onClick={load}>{bt.refresh}</Button>
        </div>
      </Card>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-40 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowCreate(false); }}>
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl p-6"
            style={{ background: "var(--surface)", boxShadow: "var(--shadow-lg)" }}>
            <h2 className="mb-4 text-base font-bold">{bt.newBuild}</h2>
            {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>{bt.buildTitle} *</label>
                <Input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder={bt.buildTitlePlaceholder} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>{bt.selectCustomer} *</label>
                <select className="app-input w-full" value={formCustomerId} onChange={(e) => setFormCustomerId(e.target.value)}>
                  <option value="">—</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.phone})</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>{bt.selectTechnician}</label>
                <select className="app-input w-full" value={formTechnicianId} onChange={(e) => setFormTechnicianId(e.target.value)}>
                  <option value="">—</option>
                  {techUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>{bt.estimatedCost} (EGP)</label>
                <Input type="number" min="0" value={formEstimatedCost} onChange={(e) => setFormEstimatedCost(e.target.value)} placeholder="0" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>{bt.laborCost} (EGP)</label>
                <Input type="number" min="0" value={formLaborCost} onChange={(e) => setFormLaborCost(e.target.value)} placeholder="0" />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>{bt.notes}</label>
                <textarea className="app-input w-full" rows={2} value={formNotes} onChange={(e) => setFormNotes(e.target.value)} />
              </div>
            </div>

            {/* Parts */}
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold">{bt.parts}</p>
                <Button variant="secondary" onClick={addPart}>
                  <Plus size={14} aria-hidden /> {bt.addPart}
                </Button>
              </div>
              {formParts.length === 0 && (
                <p className="text-xs" style={{ color: "var(--muted)" }}>{bt.noPartsYet}</p>
              )}
              {formParts.map((part, i) => (
                <div key={i} className="mb-2 grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-5">
                    <label className="mb-1 block text-xs" style={{ color: "var(--muted)" }}>{bt.selectProduct}</label>
                    <select className="app-input w-full" value={part.productId} onChange={(e) => onProductSelect(i, e.target.value)}>
                      <option value="">—</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="mb-1 block text-xs" style={{ color: "var(--muted)" }}>{bt.quantity}</label>
                    <Input type="number" min="1" value={part.quantity}
                      onChange={(e) => updatePart(i, "quantity", Number(e.target.value))} />
                  </div>
                  <div className="col-span-3">
                    <label className="mb-1 block text-xs" style={{ color: "var(--muted)" }}>{bt.unitCost}</label>
                    <Input type="number" min="0" step="0.01" value={part.unitCost}
                      onChange={(e) => updatePart(i, "unitCost", Number(e.target.value))} />
                  </div>
                  <div className="col-span-2">
                    <Button variant="danger" onClick={() => removePart(i)} className="w-full">{bt.partRemove}</Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 flex gap-2 justify-end">
              <Button variant="secondary" onClick={() => setShowCreate(false)}>{t.actions.cancel}</Button>
              <Button onClick={handleCreate} disabled={saving}>
                {saving ? t.actions.saving : bt.createBuild}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <Card>
        <SectionTitle title={bt.title} />
        {loading ? (
          <p className="py-8 text-center text-sm" style={{ color: "var(--muted)" }}>{t.actions.loading}</p>
        ) : builds.length === 0 ? (
          <div className="py-12 text-center">
            <Cpu size={40} strokeWidth={1.5} className="mx-auto mb-3" style={{ color: "var(--muted)" }} />
            <p className="text-sm font-medium" style={{ color: "var(--muted)" }}>{bt.noBuilds}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {[bt.colBuild, bt.colCustomer, bt.colTitle, bt.colStatus, bt.colParts, bt.colCost, bt.colActions].map((h) => (
                    <th key={h} className="px-3 py-2 text-start text-xs font-semibold" style={{ color: "var(--muted)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {builds.map((b) => (
                  <tr key={b.id} style={{ borderBottom: "1px solid var(--border)" }} className="hover:bg-[color-mix(in_srgb,var(--accent)_4%,transparent)]">
                    <td className="px-3 py-2.5">
                      <span className="font-mono text-xs font-semibold" style={{ color: "var(--accent)" }}>{b.buildNumber}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <User size={13} style={{ color: "var(--muted)" }} aria-hidden />
                        <span className="font-medium">{b.customer.name}</span>
                      </div>
                      {b.technician && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <Wrench size={11} style={{ color: "var(--muted)" }} aria-hidden />
                          <span className="text-xs" style={{ color: "var(--muted)" }}>{b.technician.name}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-medium max-w-[180px] truncate">{b.title}</td>
                    <td className="px-3 py-2.5">
                      <StatusBadge tone={STATUS_COLORS[b.status] ?? "neutral"}>
                        {statusLabel(b.status)}
                      </StatusBadge>
                    </td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: "var(--muted)" }}>
                      {b.parts.length} {lang === "ar" ? "مكون" : "parts"}<br />
                      <span className="font-semibold" style={{ color: "var(--foreground)" }}>
                        {formatEGP(partsCost(b.parts))}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-semibold">
                      {b.finalCost != null ? formatEGP(b.finalCost) : b.estimatedCost != null ? `~${formatEGP(b.estimatedCost)}` : "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <Link href={`/builds/${b.id}`}
                        className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-all hover:opacity-80"
                        style={{ borderColor: "var(--border)", background: "var(--surface-muted)" }}>
                        {bt.open}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </AppPage>
  );
}
