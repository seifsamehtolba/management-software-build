"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useLang } from "@/lib/i18n";
import { AppPage, Button, Card, Input, PageHeader, SectionTitle, StatusBadge } from "@/components/ui/primitives";
import { parseResponseJson } from "@/lib/parseResponseJson";
import { CheckCircle, Package, RefreshCw } from "lucide-react";

type BuildPart = {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  sellPrice: number;
  costPrice: number;
  quantity: number;
  unitCost: number;
  note: string | null;
};

type BuildDetail = {
  id: string;
  buildNumber: string;
  title: string;
  status: string;
  customer: { id: string; name: string; phone: string; email?: string };
  technician: { id: string; name: string } | null;
  estimatedCost: number | null;
  laborCost: number | null;
  finalCost: number | null;
  notes: string | null;
  convertedSale: { id: string; invoiceNumber: string } | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
  parts: BuildPart[];
};

const STATUSES = ["PLANNING", "SOURCING", "ASSEMBLING", "TESTING", "READY", "DELIVERED", "CANCELLED"] as const;

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
  return new Intl.NumberFormat("ar-EG", { style: "currency", currency: "EGP", maximumFractionDigits: 2 }).format(n);
}

export default function BuildDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { t, lang } = useLang();
  const bt = t.builds as Record<string, string>;

  const [build, setBuild] = useState<BuildDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    const res = await fetch(`/api/builds/${id}`);
    if (res.ok) {
      const data = await parseResponseJson<BuildDetail>(res);
      if (data) setBuild(data);
    } else {
      setError(t.errors.notFound);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [id]);

  const updateStatus = async (status: string) => {
    if (!build) return;
    setUpdatingStatus(true);
    setMsg("");
    const res = await fetch(`/api/builds/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setUpdatingStatus(false);
    if (res.ok) { setMsg(lang === "ar" ? "تم تحديث الحالة." : "Status updated."); load(); }
    else setError(t.errors.generic);
  };

  const completeBuild = async () => {
    if (!build) return;
    setCompleting(true);
    setMsg("");
    const res = await fetch(`/api/builds/${id}/complete`, { method: "POST" });
    setCompleting(false);
    if (res.ok) {
      setMsg(bt.buildConverted);
      load();
    } else {
      const d = await res.json().catch(() => ({}));
      setError((d as { message?: string }).message ?? t.errors.generic);
    }
  };

  if (loading) return (
    <AppPage>
      <p className="p-8 text-center text-sm" style={{ color: "var(--muted)" }}>{bt.loadingBuild}</p>
    </AppPage>
  );

  if (!build) return (
    <AppPage>
      <p className="p-8 text-center text-sm text-red-600">{error || t.errors.notFound}</p>
    </AppPage>
  );

  const statusLabel = (s: string) => {
    const map: Record<string, string> = {
      PLANNING: bt.statusPlanning, SOURCING: bt.statusSourcing,
      ASSEMBLING: bt.statusAssembling, TESTING: bt.statusTesting,
      READY: bt.statusReady, DELIVERED: bt.statusDelivered, CANCELLED: bt.statusCancelled,
    };
    return map[s] ?? s;
  };

  const partsCost = build.parts.reduce((sum, p) => sum + p.unitCost * p.quantity, 0);
  const totalCost = partsCost + (build.laborCost ?? 0);
  const isTerminal = build.status === "DELIVERED" || build.status === "CANCELLED";

  return (
    <AppPage>
      <PageHeader
        title={`${bt.buildNumber} ${build.buildNumber}`}
        subtitle={build.title}
        actions={
          <Button variant="secondary" onClick={load}>
            <RefreshCw size={15} aria-hidden /> {bt.refresh}
          </Button>
        }
      />

      {msg && <div className="mb-4 rounded-lg bg-green-50 px-4 py-2 text-sm text-green-700">{msg}</div>}
      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Left: Details */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          {/* Info card */}
          <Card>
            <SectionTitle title={lang === "ar" ? "معلومات الطلب" : "Build Info"} />
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <p className="text-xs" style={{ color: "var(--muted)" }}>{lang === "ar" ? "العميل" : "Customer"}</p>
                <p className="font-semibold">{build.customer.name}</p>
                <p className="text-xs" style={{ color: "var(--muted)" }}>{build.customer.phone}</p>
              </div>
              <div>
                <p className="text-xs" style={{ color: "var(--muted)" }}>{lang === "ar" ? "الفني" : "Technician"}</p>
                <p className="font-semibold">{build.technician?.name ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs" style={{ color: "var(--muted)" }}>{lang === "ar" ? "الحالة" : "Status"}</p>
                <StatusBadge tone={STATUS_COLORS[build.status] ?? "neutral"}>{statusLabel(build.status)}</StatusBadge>
              </div>
              <div>
                <p className="text-xs" style={{ color: "var(--muted)" }}>{lang === "ar" ? "تاريخ الإنشاء" : "Created"}</p>
                <p>{new Date(build.createdAt).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB")}</p>
              </div>
              {build.notes && (
                <div className="col-span-2">
                  <p className="text-xs" style={{ color: "var(--muted)" }}>{bt.notes}</p>
                  <p className="whitespace-pre-wrap">{build.notes}</p>
                </div>
              )}
              {build.convertedSale && (
                <div className="col-span-2">
                  <p className="text-xs" style={{ color: "var(--muted)" }}>{lang === "ar" ? "رقم الفاتورة" : "Invoice"}</p>
                  <p className="font-mono font-semibold" style={{ color: "var(--accent)" }}>{build.convertedSale.invoiceNumber}</p>
                </div>
              )}
            </div>
          </Card>

          {/* Parts */}
          <Card>
            <SectionTitle title={bt.parts} />
            {build.parts.length === 0 ? (
              <p className="py-4 text-sm" style={{ color: "var(--muted)" }}>{bt.noPartsYet}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      {[lang === "ar" ? "المكون" : "Component", bt.quantity, bt.unitCost, lang === "ar" ? "الإجمالي" : "Total"].map((h) => (
                        <th key={h} className="px-3 py-2 text-start text-xs font-semibold" style={{ color: "var(--muted)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {build.parts.map((p) => (
                      <tr key={p.id} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td className="px-3 py-2.5">
                          <p className="font-medium">{p.productName}</p>
                          <p className="text-xs" style={{ color: "var(--muted)" }}>{p.productSku}</p>
                          {p.note && <p className="text-xs italic" style={{ color: "var(--muted)" }}>{p.note}</p>}
                        </td>
                        <td className="px-3 py-2.5">{p.quantity}</td>
                        <td className="px-3 py-2.5">{formatEGP(p.unitCost)}</td>
                        <td className="px-3 py-2.5 font-semibold">{formatEGP(p.unitCost * p.quantity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {/* Right: Actions & costs */}
        <div className="flex flex-col gap-4">
          {/* Cost summary */}
          <Card>
            <SectionTitle title={lang === "ar" ? "ملخص التكلفة" : "Cost Summary"} />
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <span style={{ color: "var(--muted)" }}>{bt.totalPartsCost}</span>
                <span className="font-semibold">{formatEGP(partsCost)}</span>
              </div>
              {(build.laborCost ?? 0) > 0 && (
                <div className="flex justify-between">
                  <span style={{ color: "var(--muted)" }}>{bt.laborCost}</span>
                  <span className="font-semibold">{formatEGP(build.laborCost!)}</span>
                </div>
              )}
              <div className="flex justify-between border-t pt-2" style={{ borderColor: "var(--border)" }}>
                <span className="font-bold">{bt.totalBuildCost}</span>
                <span className="font-bold text-base" style={{ color: "var(--accent)" }}>{formatEGP(totalCost)}</span>
              </div>
              {build.estimatedCost != null && (
                <div className="flex justify-between text-xs" style={{ color: "var(--muted)" }}>
                  <span>{bt.estimatedCost}</span>
                  <span>{formatEGP(build.estimatedCost)}</span>
                </div>
              )}
            </div>
          </Card>

          {/* Status update */}
          {!isTerminal && (
            <Card>
              <SectionTitle title={bt.updateStatus} />
              <div className="flex flex-col gap-2">
                {STATUSES.filter((s) => s !== "CANCELLED" || build.status !== "DELIVERED").map((s) => (
                  <button
                    key={s}
                    onClick={() => updateStatus(s)}
                    disabled={updatingStatus || s === build.status}
                    className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm font-medium transition-all hover:opacity-80 disabled:opacity-40"
                    style={{
                      borderColor: s === build.status ? "var(--accent)" : "var(--border)",
                      background: s === build.status ? "color-mix(in srgb, var(--accent) 8%, var(--surface))" : "var(--surface-muted)",
                    }}
                  >
                    <span>{statusLabel(s)}</span>
                    {s === build.status && <CheckCircle size={14} style={{ color: "var(--accent)" }} aria-hidden />}
                  </button>
                ))}
              </div>
            </Card>
          )}

          {/* Complete build */}
          {!build.convertedSale && !isTerminal && build.parts.length > 0 && (
            <Card>
              <SectionTitle title={lang === "ar" ? "إصدار الفاتورة" : "Issue Invoice"} />
              <p className="mb-3 text-xs" style={{ color: "var(--muted)" }}>
                {lang === "ar"
                  ? "سيتم إنشاء فاتورة بيع تلقائياً تحتوي على جميع المكونات."
                  : "A sale invoice will be automatically created with all components."}
              </p>
              <Button onClick={completeBuild} disabled={completing} className="w-full">
                <Package size={15} aria-hidden />
                {completing ? bt.completing : bt.completeBuild}
              </Button>
            </Card>
          )}
        </div>
      </div>
    </AppPage>
  );
}
