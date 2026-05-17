"use client";

import { useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";
import { AppPage, Button, Card, Input, PageHeader, SectionTitle, StatusBadge } from "@/components/ui/primitives";
import { parseResponseJson } from "@/lib/parseResponseJson";
import { RefreshCw, LockOpen, Lock, AlertTriangle, CheckCircle } from "lucide-react";

type ShiftEntry = {
  id: string;
  type: string;
  amount: number;
  note: string | null;
  createdAt: string;
};

type CashShift = {
  id: string;
  status: "OPEN" | "CLOSED";
  branch: { id: string; name: string } | null;
  user: { id: string; name: string };
  openedAt: string;
  closedAt: string | null;
  openingCash: number;
  expectedCash: number;
  countedCash: number | null;
  variance: number;
  notes: string | null;
  entries: ShiftEntry[];
};

type Branch = { id: string; name: string };

function formatEGP(n: number) {
  return new Intl.NumberFormat("ar-EG", { style: "currency", currency: "EGP", maximumFractionDigits: 2 }).format(n);
}

function formatTime(iso: string, lang: string) {
  return new Date(iso).toLocaleString(lang === "ar" ? "ar-EG" : "en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export default function CashShiftsPage() {
  const { t, lang } = useLang();
  const ct = t.cashShifts as Record<string, string>;

  const [shifts, setShifts] = useState<CashShift[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedShift, setSelectedShift] = useState<CashShift | null>(null);

  // Open shift form
  const [openingCash, setOpeningCash] = useState("0");
  const [openBranchId, setOpenBranchId] = useState("");
  const [openNotes, setOpenNotes] = useState("");
  const [opening, setOpening] = useState(false);

  // Close shift form
  const [countedCash, setCountedCash] = useState("");
  const [closeNotes, setCloseNotes] = useState("");
  const [closing, setClosing] = useState(false);

  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    const [shiftsRes, branchesRes] = await Promise.all([
      fetch("/api/cash-shifts"),
      fetch("/api/branches"),
    ]);
    if (shiftsRes.ok) {
      const data = await parseResponseJson<CashShift[]>(shiftsRes);
      if (data) {
        setShifts(data);
        const open = data.find((s) => s.status === "OPEN");
        setSelectedShift(open ?? data[0] ?? null);
      }
    }
    if (branchesRes.ok) {
      const data = await parseResponseJson<Branch[]>(branchesRes);
      if (data) setBranches(data);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleOpenShift = async () => {
    setMsg(""); setError("");
    const cash = Number(openingCash);
    if (!Number.isFinite(cash) || cash < 0) { setError(lang === "ar" ? "أدخل رصيداً صحيحاً" : "Enter a valid amount"); return; }
    setOpening(true);
    const res = await fetch("/api/cash-shifts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ openingCash: cash, branchId: openBranchId || undefined, notes: openNotes || undefined }),
    });
    setOpening(false);
    if (res.ok) { setMsg(ct.shiftOpened); setOpeningCash("0"); setOpenNotes(""); load(); }
    else {
      const d = await res.json().catch(() => ({}));
      setError((d as { message?: string }).message ?? t.errors.generic);
    }
  };

  const closeShift = async () => {
    if (!selectedShift) return;
    setMsg(""); setError("");
    const cash = Number(countedCash);
    if (!Number.isFinite(cash) || cash < 0) { setError(lang === "ar" ? "أدخل المبلغ المعدود" : "Enter counted cash"); return; }
    setClosing(true);
    const res = await fetch(`/api/cash-shifts/${selectedShift.id}/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ countedCash: cash, notes: closeNotes || undefined }),
    });
    setClosing(false);
    if (res.ok) { setMsg(ct.shiftClosed); setCountedCash(""); setCloseNotes(""); load(); }
    else {
      const d = await res.json().catch(() => ({}));
      setError((d as { message?: string }).message ?? t.errors.generic);
    }
  };

  const entryTypeLabel = (type: string) => {
    const map: Record<string, string> = {
      OPENING_FLOAT: ct.typeOpening,
      SALE_CASH: ct.typeSale,
      REFUND_CASH: ct.typeRefund,
      PAYIN: ct.typePayin,
      PAYOUT: ct.typePayout,
      CLOSE: ct.typeClose,
    };
    return map[type] ?? type;
  };

  const currentShift = shifts.find((s) => s.status === "OPEN");
  const pastShifts = shifts.filter((s) => s.status === "CLOSED").slice(0, 20);

  return (
    <AppPage>
      <PageHeader
        title={ct.title}
        subtitle={ct.subtitle}
        actions={
          <Button variant="secondary" onClick={load}>
            <RefreshCw size={15} aria-hidden /> {ct.refresh}
          </Button>
        }
      />

      {msg && <div className="mb-4 rounded-lg bg-green-50 px-4 py-2 text-sm text-green-700">{msg}</div>}
      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Left: Current shift */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          {loading ? (
            <Card><p className="py-8 text-center text-sm" style={{ color: "var(--muted)" }}>{ct.loading}</p></Card>
          ) : currentShift ? (
            <Card>
              <div className="mb-4 flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: "color-mix(in srgb, var(--accent) 15%, transparent)" }}>
                  <LockOpen size={16} style={{ color: "var(--accent)" }} aria-hidden />
                </div>
                <div>
                  <p className="font-bold text-sm">{ct.currentShift}</p>
                  <p className="text-xs" style={{ color: "var(--muted)" }}>
                    {ct.cashier}: {currentShift.user.name} · {currentShift.branch?.name ?? "—"} · {formatTime(currentShift.openedAt, lang)}
                  </p>
                </div>
                <StatusBadge tone="success">{ct.statusOpen}</StatusBadge>
              </div>

              <div className="mb-4 grid grid-cols-3 gap-3">
                <div className="rounded-xl p-3" style={{ background: "var(--surface-muted)" }}>
                  <p className="text-xs" style={{ color: "var(--muted)" }}>{ct.openingCash}</p>
                  <p className="mt-1 text-lg font-bold">{formatEGP(currentShift.openingCash)}</p>
                </div>
                <div className="rounded-xl p-3" style={{ background: "var(--surface-muted)" }}>
                  <p className="text-xs" style={{ color: "var(--muted)" }}>{ct.expectedCash}</p>
                  <p className="mt-1 text-lg font-bold">{formatEGP(currentShift.expectedCash)}</p>
                </div>
                <div className="rounded-xl p-3" style={{ background: "var(--surface-muted)" }}>
                  <p className="text-xs" style={{ color: "var(--muted)" }}>
                    {lang === "ar" ? "عدد الحركات" : "Entries"}
                  </p>
                  <p className="mt-1 text-lg font-bold">{currentShift.entries.length}</p>
                </div>
              </div>

              {/* Entries */}
              <SectionTitle title={ct.entries} />
              <div className="mt-2 max-h-56 overflow-y-auto">
                {currentShift.entries.length === 0 ? (
                  <p className="text-xs" style={{ color: "var(--muted)" }}>{lang === "ar" ? "لا توجد حركات بعد." : "No entries yet."}</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border)" }}>
                        {[ct.entryType, ct.entryAmount, ct.entryNote, ct.entryTime].map((h) => (
                          <th key={h} className="px-2 py-1.5 text-start font-semibold" style={{ color: "var(--muted)" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {currentShift.entries.map((e) => (
                        <tr key={e.id} style={{ borderBottom: "1px solid var(--border)" }}>
                          <td className="px-2 py-1.5">{entryTypeLabel(e.type)}</td>
                          <td className="px-2 py-1.5 font-semibold"
                            style={{ color: e.type === "REFUND_CASH" || e.type === "PAYOUT" ? "#ef4444" : "#10b981" }}>
                            {e.type === "REFUND_CASH" || e.type === "PAYOUT" ? "-" : "+"}{formatEGP(Math.abs(e.amount))}
                          </td>
                          <td className="px-2 py-1.5" style={{ color: "var(--muted)" }}>{e.note ?? "—"}</td>
                          <td className="px-2 py-1.5" style={{ color: "var(--muted)" }}>{formatTime(e.createdAt, lang)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </Card>
          ) : (
            <Card>
              <div className="py-8 text-center">
                <Lock size={40} strokeWidth={1.5} className="mx-auto mb-3" style={{ color: "var(--muted)" }} />
                <p className="font-medium" style={{ color: "var(--muted)" }}>{ct.noShifts}</p>
              </div>
            </Card>
          )}

          {/* Past shifts */}
          {pastShifts.length > 0 && (
            <Card>
              <SectionTitle title={ct.pastShifts} />
              <div className="overflow-x-auto mt-2">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      {[ct.cashier, ct.openedAt, ct.closedAt, ct.openingCash, ct.expectedCash, ct.countedCash, ct.variance].map((h) => (
                        <th key={h} className="px-3 py-2 text-start text-xs font-semibold" style={{ color: "var(--muted)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pastShifts.map((s) => {
                      const varianceOk = Math.abs(s.variance) < 1;
                      const varianceOver = s.variance > 0;
                      return (
                        <tr key={s.id} className="cursor-pointer hover:bg-[color-mix(in_srgb,var(--accent)_4%,transparent)]"
                          onClick={() => setSelectedShift(s)}
                          style={{ borderBottom: "1px solid var(--border)" }}>
                          <td className="px-3 py-2.5">{s.user.name}</td>
                          <td className="px-3 py-2.5 text-xs">{formatTime(s.openedAt, lang)}</td>
                          <td className="px-3 py-2.5 text-xs">{s.closedAt ? formatTime(s.closedAt, lang) : "—"}</td>
                          <td className="px-3 py-2.5">{formatEGP(s.openingCash)}</td>
                          <td className="px-3 py-2.5">{formatEGP(s.expectedCash)}</td>
                          <td className="px-3 py-2.5">{s.countedCash != null ? formatEGP(s.countedCash) : "—"}</td>
                          <td className="px-3 py-2.5">
                            {varianceOk ? (
                              <span className="flex items-center gap-1 text-xs text-green-600">
                                <CheckCircle size={12} aria-hidden /> {ct.varianceOk}
                              </span>
                            ) : (
                              <span className={`flex items-center gap-1 text-xs ${varianceOver ? "text-blue-600" : "text-red-600"}`}>
                                <AlertTriangle size={12} aria-hidden />
                                {varianceOver ? ct.varianceOver : ct.varianceShort} {formatEGP(Math.abs(s.variance))}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>

        {/* Right: Actions */}
        <div className="flex flex-col gap-4">
          {!currentShift ? (
            <Card>
              <SectionTitle title={ct.openShift} />
              <div className="flex flex-col gap-3 mt-2">
                {branches.length > 0 && (
                  <div>
                    <label className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>{ct.selectBranch}</label>
                    <select className="app-input w-full" value={openBranchId} onChange={(e) => setOpenBranchId(e.target.value)}>
                      <option value="">—</option>
                      {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <label className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>{ct.openingCash}</label>
                  <Input type="number" min="0" step="0.01" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>{ct.shiftNotes}</label>
                  <Input value={openNotes} onChange={(e) => setOpenNotes(e.target.value)} placeholder={lang === "ar" ? "اختياري" : "Optional"} />
                </div>
                <Button onClick={handleOpenShift} disabled={opening} className="w-full">
                  <LockOpen size={15} aria-hidden />
                  {opening ? ct.opening : ct.openShiftBtn}
                </Button>
              </div>
            </Card>
          ) : (
            <Card>
              <SectionTitle title={ct.closeShift} />
              <div className="flex flex-col gap-3 mt-2">
                <div className="rounded-xl p-3" style={{ background: "color-mix(in srgb, var(--accent) 8%, var(--surface))" }}>
                  <p className="text-xs" style={{ color: "var(--muted)" }}>{ct.expectedCash}</p>
                  <p className="text-xl font-bold" style={{ color: "var(--accent)" }}>{formatEGP(currentShift.expectedCash)}</p>
                  <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                    {lang === "ar" ? "أدخل المبلغ الفعلي الذي ستحسبه في الصندوق" : "Enter the actual cash counted in the drawer"}
                  </p>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>{ct.countedCash}</label>
                  <Input type="number" min="0" step="0.01" value={countedCash}
                    onChange={(e) => setCountedCash(e.target.value)} placeholder="0.00" />
                </div>
                {countedCash && Number.isFinite(Number(countedCash)) && (
                  <div className="rounded-lg px-3 py-2 text-sm"
                    style={{
                      background: Math.abs(Number(countedCash) - currentShift.expectedCash) < 1
                        ? "color-mix(in srgb, #10b981 10%, transparent)"
                        : "color-mix(in srgb, #ef4444 10%, transparent)",
                    }}>
                    <span className="font-semibold">{ct.variance}: </span>
                    {formatEGP(Number(countedCash) - currentShift.expectedCash)}
                  </div>
                )}
                <div>
                  <label className="mb-1 block text-xs font-medium" style={{ color: "var(--muted)" }}>{ct.shiftNotes}</label>
                  <Input value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)} placeholder={lang === "ar" ? "اختياري" : "Optional"} />
                </div>
                <Button variant="danger" onClick={closeShift} disabled={closing} className="w-full">
                  <Lock size={15} aria-hidden />
                  {closing ? ct.closing : ct.closeShift}
                </Button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </AppPage>
  );
}
