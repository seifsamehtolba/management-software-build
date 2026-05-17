"use client";

import { useEffect, useMemo, useState } from "react";
import { AppPage, Button, Card, EmptyState, Input, PageHeader, SectionTitle, Select, StatusBadge } from "@/components/ui/primitives";
import { errorMessageFromJson, parseResponseJson } from "@/lib/parseResponseJson";
import { useLang } from "@/lib/i18n";

type PayableRow = {
  id: string;
  poNumber: string;
  supplierId: string;
  supplierName: string;
  supplierTerms: string | null;
  branchId: string | null;
  branchName: string;
  status: string;
  total: number;
  paidAmount: number;
  outstanding: number;
  dueDate: string | null;
  overdueDays: number;
  agingBucket: "current" | "1_30" | "31_60" | "61_plus";
  payments: Array<{
    id: string;
    amount: number;
    method: string;
    note?: string | null;
    reference?: string | null;
    paidAt: string;
    reversedAt: string | null;
    reversalNote?: string | null;
  }>;
};

type PayablesPayload = {
  rows: PayableRow[];
  aging: { current: number; "1_30": number; "31_60": number; "61_plus": number; totalOutstanding: number };
};

type BranchRow = { id: string; name: string };

export default function PayablesPage() {
  const { lang } = useLang();
  const [branchId, setBranchId] = useState("");
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [data, setData] = useState<PayablesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [paymentForm, setPaymentForm] = useState({
    poId: "",
    amount: "",
    method: "BANK_TRANSFER",
    note: "",
  });

  const fmtMoney = (value: number) =>
    new Intl.NumberFormat(lang === "ar" ? "ar-EG" : "en-EG", { style: "currency", currency: "EGP" }).format(value);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (branchId) params.set("branchId", branchId);
      const [payablesRes, branchesRes] = await Promise.all([
        fetch(`/api/payables?${params.toString()}`),
        fetch("/api/branches"),
      ]);
      if (payablesRes.ok) {
        const payload = await parseResponseJson<PayablesPayload>(payablesRes);
        setData(payload ?? null);
      }
      if (branchesRes.ok) {
        const payload = await parseResponseJson<BranchRow[]>(branchesRes);
        setBranches(Array.isArray(payload) ? payload : []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [branchId]);

  const openRows = useMemo(() => data?.rows ?? [], [data]);

  const submitPayment = async () => {
    if (!paymentForm.poId || !paymentForm.amount) return;
    const res = await fetch("/api/finance/supplier-payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        poId: paymentForm.poId,
        amount: Number(paymentForm.amount),
        method: paymentForm.method,
        note: paymentForm.note || undefined,
      }),
    });
    const payload = await parseResponseJson<{ message?: string }>(res);
    if (!res.ok) {
      setStatus(errorMessageFromJson(payload, "Could not record payment"));
      return;
    }
    setPaymentForm({ poId: "", amount: "", method: "BANK_TRANSFER", note: "" });
    setStatus("Payment recorded.");
    await load();
  };

  const reversePayment = async (paymentId: string) => {
    const res = await fetch(`/api/supplier-payments/${paymentId}/reverse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: "Reversed from payables workspace" }),
    });
    const payload = await parseResponseJson<{ message?: string }>(res);
    if (!res.ok) {
      setStatus(errorMessageFromJson(payload, "Could not reverse payment"));
      return;
    }
    setStatus("Payment reversed.");
    await load();
  };

  return (
    <AppPage>
      <PageHeader title="Payables" subtitle="Track supplier dues, aging, and payment history by branch." />

      <Card className="mb-6">
        <SectionTitle title="Aging summary" />
        <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr]">
          <Select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
            <option value="">All branches</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
          <Button type="button" variant="secondary" onClick={() => void load()}>
            Refresh
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Card><p className="text-xs" style={{ color: "var(--muted)" }}>Current</p><p className="text-lg font-semibold">{fmtMoney(data?.aging.current ?? 0)}</p></Card>
          <Card><p className="text-xs" style={{ color: "var(--muted)" }}>1-30 days</p><p className="text-lg font-semibold">{fmtMoney(data?.aging["1_30"] ?? 0)}</p></Card>
          <Card><p className="text-xs" style={{ color: "var(--muted)" }}>31-60 days</p><p className="text-lg font-semibold">{fmtMoney(data?.aging["31_60"] ?? 0)}</p></Card>
          <Card><p className="text-xs" style={{ color: "var(--muted)" }}>61+ days</p><p className="text-lg font-semibold">{fmtMoney(data?.aging["61_plus"] ?? 0)}</p></Card>
          <Card><p className="text-xs" style={{ color: "var(--muted)" }}>Outstanding</p><p className="text-lg font-semibold">{fmtMoney(data?.aging.totalOutstanding ?? 0)}</p></Card>
        </div>
      </Card>

      <Card className="mb-6">
        <SectionTitle title="Record supplier payment" />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Select value={paymentForm.poId} onChange={(event) => setPaymentForm((current) => ({ ...current, poId: event.target.value }))}>
            <option value="">Select purchase order</option>
            {openRows.map((row) => (
              <option key={row.id} value={row.id}>
                {row.poNumber} · {row.supplierName} · {fmtMoney(row.outstanding)}
              </option>
            ))}
          </Select>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={paymentForm.amount}
            onChange={(event) => setPaymentForm((current) => ({ ...current, amount: event.target.value }))}
            placeholder="Amount"
          />
          <Select value={paymentForm.method} onChange={(event) => setPaymentForm((current) => ({ ...current, method: event.target.value }))}>
            <option value="BANK_TRANSFER">Bank transfer</option>
            <option value="CASH">Cash</option>
            <option value="CARD">Card</option>
            <option value="FAWRY">Fawry</option>
            <option value="VODAFONE_CASH">Vodafone Cash</option>
          </Select>
          <Input value={paymentForm.note} onChange={(event) => setPaymentForm((current) => ({ ...current, note: event.target.value }))} placeholder="Note" />
        </div>
        <div className="mt-3 flex gap-2">
          <Button type="button" onClick={() => void submitPayment()}>Save payment</Button>
          {status ? <p className="text-sm" style={{ color: "var(--muted)" }}>{status}</p> : null}
        </div>
      </Card>

      <Card>
        <SectionTitle title="Open payables" subtitle={`${openRows.length}`} />
        {loading ? <p className="text-sm" style={{ color: "var(--muted)" }}>Loading payables...</p> : null}
        {!loading && openRows.length === 0 ? <EmptyState title="No supplier balances due." /> : null}
        <div className="space-y-4">
          {openRows.map((row) => (
            <div key={row.id} className="rounded-xl border p-4" style={{ borderColor: "var(--border)" }}>
              <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="font-semibold">{row.poNumber} · {row.supplierName}</p>
                  <p className="text-sm" style={{ color: "var(--muted)" }}>
                    {row.branchName} · Due {row.dueDate ? new Date(row.dueDate).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-EG") : "unscheduled"}
                    {row.overdueDays > 0 ? ` · ${row.overdueDays} days overdue` : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <StatusBadge tone={row.overdueDays > 60 ? "danger" : row.overdueDays > 0 ? "warning" : "neutral"}>
                      {row.agingBucket.replace("_", "-")}
                    </StatusBadge>
                    <StatusBadge tone="neutral">{row.status}</StatusBadge>
                  </div>
                </div>
                <div className="text-sm">
                  <p>Total: {fmtMoney(row.total)}</p>
                  <p>Paid: {fmtMoney(row.paidAmount)}</p>
                  <p className="font-semibold">Outstanding: {fmtMoney(row.outstanding)}</p>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                <p className="text-sm font-medium">Payment history</p>
                {row.payments.length === 0 ? (
                  <p className="text-sm" style={{ color: "var(--muted)" }}>No payments yet.</p>
                ) : (
                  row.payments.map((payment) => (
                    <div key={payment.id} className="flex flex-col gap-2 rounded-lg border p-3 text-sm md:flex-row md:items-center md:justify-between" style={{ borderColor: "var(--border)" }}>
                      <div>
                        <p>{payment.method} · {fmtMoney(payment.amount)}</p>
                        <p style={{ color: "var(--muted)" }}>
                          {new Date(payment.paidAt).toLocaleString(lang === "ar" ? "ar-EG" : "en-EG")}
                          {payment.note ? ` · ${payment.note}` : ""}
                        </p>
                        {payment.reversedAt ? (
                          <p style={{ color: "var(--warning)" }}>
                            Reversed {new Date(payment.reversedAt).toLocaleString(lang === "ar" ? "ar-EG" : "en-EG")}
                          </p>
                        ) : null}
                      </div>
                      {!payment.reversedAt ? (
                        <Button type="button" variant="secondary" className="text-xs" onClick={() => void reversePayment(payment.id)}>
                          Reverse payment
                        </Button>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </AppPage>
  );
}
