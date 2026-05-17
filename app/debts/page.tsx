"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppPage, Button, Card, EmptyState, Input, PageHeader, SectionTitle } from "@/components/ui/primitives";
import { errorMessageFromJson, parseResponseJson } from "@/lib/parseResponseJson";
import { useLang } from "@/lib/i18n";

type DebtorRow = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  creditBalance: number;
  type: string;
};

type CustomerApiResponse = {
  rows: DebtorRow[];
  page: number;
  pageSize: number;
  total: number;
};

export default function DebtsPage() {
  const { t, lang } = useLang();
  const td = t.debts;
  const [debtors, setDebtors] = useState<DebtorRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [payingId, setPayingId] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");

  const fmt = (n: number) =>
    new Intl.NumberFormat(lang === "ar" ? "ar-EG" : "en-EG", { style: "currency", currency: "EGP" }).format(n);

  const load = useCallback(async (q?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("inDebt", "1");
      params.set("includeBlacklisted", "1");
      params.set("pageSize", "200");
      if (q?.trim()) params.set("q", q.trim());
      const res = await fetch(`/api/customers?${params.toString()}`);
      const data = await parseResponseJson<CustomerApiResponse>(res);
      const rows = data?.rows ?? [];
      setDebtors(rows.sort((a, b) => a.creditBalance - b.creditBalance));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(query), 350);
    return () => clearTimeout(timer);
  }, [query, load]);

  const totalDebt = useMemo(
    () => debtors.reduce((sum, d) => sum + Math.abs(d.creditBalance), 0),
    [debtors],
  );

  const recordPayment = async (debtor: DebtorRow) => {
    const amount = Number(paymentAmount);
    if (!amount || amount <= 0) return;
    setStatus("");
    const newBalance = debtor.creditBalance + amount;
    const res = await fetch(`/api/customers/${debtor.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creditBalance: newBalance }),
    });
    const data = await parseResponseJson<{ message?: string }>(res);
    if (!res.ok) {
      setStatus(errorMessageFromJson(data, t.errors.generic));
      return;
    }
    setStatus(td.paymentSuccess);
    setPayingId(null);
    setPaymentAmount("");
    await load(query);
  };

  return (
    <AppPage>
      <PageHeader title={td.title} subtitle={td.subtitle} />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <p className="text-sm" style={{ color: "var(--muted)" }}>{td.totalExposure}</p>
          <p className="text-2xl font-bold">{fmt(totalDebt)}</p>
        </Card>
        <Card>
          <p className="text-sm" style={{ color: "var(--muted)" }}>{td.debtorCount}</p>
          <p className="text-2xl font-bold">{debtors.length}</p>
        </Card>
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <SectionTitle title={td.title} />
          <div className="ms-auto flex gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={td.searchPlaceholder}
              className="w-full max-w-xs"
            />
            <Button type="button" variant="secondary" onClick={() => void load(query)}>
              {td.refresh}
            </Button>
          </div>
        </div>

        {status ? (
          <p className="mb-3 text-sm" style={{ color: "var(--muted)" }}>{status}</p>
        ) : null}

        {loading ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>{td.loading}</p>
        ) : debtors.length === 0 ? (
          <EmptyState title={td.noDebtors} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] border-collapse text-sm">
              <thead>
                <tr className="border-b text-start" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                  <th className="px-2 py-2 font-medium text-start">{td.colCustomer}</th>
                  <th className="px-2 py-2 font-medium text-start">{td.colPhone}</th>
                  <th className="px-2 py-2 font-medium text-start">{td.colBalance}</th>
                  <th className="px-2 py-2 font-medium text-start">{td.colActions}</th>
                </tr>
              </thead>
              <tbody>
                {debtors.map((debtor) => (
                  <>
                    <tr key={debtor.id} className="border-b" style={{ borderColor: "var(--border)" }}>
                      <td className="px-2 py-2 font-medium">{debtor.name}</td>
                      <td className="px-2 py-2" style={{ color: "var(--muted)" }}>{debtor.phone}</td>
                      <td className="px-2 py-2 font-semibold" style={{ color: "var(--danger, #dc2626)" }}>
                        {fmt(debtor.creditBalance)}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            onClick={() => {
                              setPayingId(payingId === debtor.id ? null : debtor.id);
                              setPaymentAmount("");
                              setStatus("");
                            }}
                          >
                            {td.recordPayment}
                          </Button>
                          <Link href={`/customers/${debtor.id}`} className="app-btn app-btn-secondary py-1 text-xs">
                            {td.openProfile}
                          </Link>
                        </div>
                      </td>
                    </tr>
                    {payingId === debtor.id ? (
                      <tr className="border-b" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
                        <td colSpan={4} className="px-2 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <Input
                              type="number"
                              min="0.01"
                              step="0.01"
                              value={paymentAmount}
                              onChange={(e) => setPaymentAmount(e.target.value)}
                              placeholder={td.paymentPlaceholder}
                              className="w-40"
                            />
                            <Button type="button" onClick={() => void recordPayment(debtor)}>
                              {td.recordBtn}
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() => {
                                setPayingId(null);
                                setPaymentAmount("");
                              }}
                            >
                              {td.cancelBtn}
                            </Button>
                            <span className="text-xs" style={{ color: "var(--muted)" }}>
                              {td.paymentAmount}: {fmt(Math.abs(debtor.creditBalance))}
                            </span>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </AppPage>
  );
}
