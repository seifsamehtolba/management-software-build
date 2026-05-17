"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { parseResponseJson } from "@/lib/parseResponseJson";
import { useLang } from "@/lib/i18n";

type CustomerDetails = {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  type: string;
  creditBalance: number;
  loyaltyPoints: number;
  sales: Array<{
    id: string;
    invoiceNumber: string;
    total: number;
    status: string;
    createdAt: string;
    payments: Array<{ id: string; method: string; amount: number; createdAt: string }>;
    refunds: Array<{ id: string; amount: number; reason: string; createdAt: string }>;
  }>;
  quotes: Array<{
    id: string;
    quoteNumber: string;
    status: string;
    total: number;
    reminderCount: number;
    lastReminderAt: string | null;
    validUntil: string | null;
    createdAt: string;
  }>;
  repairTickets: Array<{
    id: string;
    ticketNumber: string;
    status: string;
    finalCost: number | null;
    createdAt: string;
    notes: Array<{ id: string; content: string; createdAt: string; user: { id: string; name: string } }>;
  }>;
  activityLogs: Array<{ id: string; action: string; tableName: string | null; recordId: string | null; createdAt: string }>;
};

type StatementEntry = {
  type: "SALE" | "PAYMENT" | "REFUND";
  date: string;
  reference: string;
  amount: number;
  runningBalance: number;
};

export default function CustomerProfilePage() {
  const params = useParams<{ id: string }>();
  const { t, lang } = useLang();
  const tc = t.customers;
  const [customer, setCustomer] = useState<CustomerDetails | null>(null);
  const [statement, setStatement] = useState<StatementEntry[]>([]);

  useEffect(() => {
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/customers/${params.id}`);
      if (!res.ok) return;
      const data = await parseResponseJson<CustomerDetails>(res);
      if (data) setCustomer(data);

      const statementRes = await fetch(`/api/customers/${params.id}/statement`);
      if (statementRes.ok) {
        const statementData = await parseResponseJson<{ statement?: StatementEntry[] }>(statementRes);
        setStatement(statementData?.statement ?? []);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [params.id]);

  if (!customer) {
    return (
      <main className="p-6 text-sm" style={{ color: "var(--muted)" }}>
        {tc.loadingProfile}
      </main>
    );
  }

  const totalSalesValue = customer.sales.reduce((sum, sale) => sum + sale.total, 0);
  const totalRefunds = customer.sales.reduce(
    (sum, sale) => sum + sale.refunds.reduce((localSum, refund) => localSum + refund.amount, 0),
    0,
  );
  const totalPayments = customer.sales.reduce(
    (sum, sale) => sum + sale.payments.reduce((localSum, payment) => localSum + payment.amount, 0),
    0,
  );
  const statementClosing = statement.length > 0 ? statement[statement.length - 1].runningBalance : 0;

  const fmt = (n: number) =>
    new Intl.NumberFormat(lang === "ar" ? "ar-EG" : "en-EG", { style: "currency", currency: "EGP" }).format(n);

  const exportStatement = () => {
    const header = ["Date", "Type", "Reference", "Amount", "RunningBalance"];
    const lines = statement.map((entry) =>
      [
        new Date(entry.date).toISOString(),
        entry.type,
        entry.reference,
        entry.amount.toFixed(2),
        entry.runningBalance.toFixed(2),
      ]
        .map((cell) => `"${String(cell).replaceAll('"', '""')}"`)
        .join(","),
    );
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `customer-statement-${customer.id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="animate-fade-in p-6">
      <h1 className="mb-1 text-2xl font-semibold">{customer.name}</h1>
      <p className="mb-4 text-sm" style={{ color: "var(--muted)" }}>
        {customer.phone} • {customer.type} • {tc.storeCredit} {fmt(customer.creditBalance)} • {tc.colPoints}{" "}
        {customer.loyaltyPoints}
      </p>

      <div className="mb-4 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
        <div className="app-card px-3 py-2">
          <span style={{ color: "var(--muted)" }}>{tc.salesCount}</span>
          <p className="text-base font-semibold">{customer.sales.length}</p>
        </div>
        <div className="app-card px-3 py-2">
          <span style={{ color: "var(--muted)" }}>{tc.quotesCount}</span>
          <p className="text-base font-semibold">{customer.quotes.length}</p>
        </div>
        <div className="app-card px-3 py-2">
          <span style={{ color: "var(--muted)" }}>{tc.repairsCount}</span>
          <p className="text-base font-semibold">{customer.repairTickets.length}</p>
        </div>
        <div className="app-card px-3 py-2">
          <span style={{ color: "var(--muted)" }}>{tc.lifetimeSales}</span>
          <p className="text-base font-semibold">{fmt(totalSalesValue)}</p>
        </div>
      </div>

      <div className="app-card mb-6 p-4 text-sm">
        <h2 className="mb-2 text-base font-semibold">{tc.customerInfo}</h2>
        <p>
          <span style={{ color: "var(--muted)" }}>{tc.email}:</span> {customer.email || "-"}
        </p>
        <p>
          <span style={{ color: "var(--muted)" }}>{tc.address}:</span> {customer.address || "-"}
        </p>
        <p>
          <span style={{ color: "var(--muted)" }}>{tc.notes}:</span> {customer.notes || "-"}
        </p>
        <p className="mt-2" style={{ color: "var(--muted)" }}>
          {tc.totalPayments}: {fmt(totalPayments)} • {tc.totalRefunds}: {fmt(totalRefunds)}
        </p>
      </div>

      <section className="app-card mb-6 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">{tc.accountStatement}</h2>
          <button type="button" onClick={exportStatement} className="app-btn app-btn-secondary text-sm">
            {tc.exportStatementCsv}
          </button>
        </div>
        {statement.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            {tc.noStatement}
          </p>
        ) : (
          <>
            <div className="mb-2 text-sm font-medium">
              {tc.closingBalance}: {fmt(statementClosing)}
            </div>
            <ul className="space-y-1 text-sm">
              {statement.slice(-20).map((entry, idx) => (
                <li
                  key={`${entry.date}-${entry.reference}-${idx}`}
                  className="rounded-[var(--radius-sm)] border px-3 py-2"
                  style={{ borderColor: "var(--border)" }}
                >
                  {new Date(entry.date).toLocaleString(lang === "ar" ? "ar-EG" : "en-EG")} • {entry.type} •{" "}
                  {entry.reference} • {fmt(entry.amount)} • {fmt(entry.runningBalance)}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="app-card mb-6 p-4">
        <h2 className="mb-3 text-base font-semibold">{tc.recentSales}</h2>
        {customer.sales.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            {tc.noSales}
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {customer.sales.map((sale) => (
              <li
                key={sale.id}
                className="rounded-[var(--radius-sm)] border px-3 py-2"
                style={{ borderColor: "var(--border)" }}
              >
                <p>
                  {sale.invoiceNumber} • {sale.status} • {fmt(sale.total)} •{" "}
                  {new Date(sale.createdAt).toLocaleString(lang === "ar" ? "ar-EG" : "en-EG")}
                </p>
                {sale.payments.length > 0 ? (
                  <p className="text-xs" style={{ color: "var(--muted)" }}>
                    {tc.payments}: {sale.payments.map((p) => `${p.method} ${fmt(p.amount)}`).join(" | ")}
                  </p>
                ) : null}
                {sale.refunds.length > 0 ? (
                  <p className="text-xs text-amber-600">
                    {tc.refunds}: {sale.refunds.map((r) => `${fmt(r.amount)} (${r.reason})`).join(" | ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="app-card mb-6 p-4">
        <h2 className="mb-3 text-base font-semibold">{tc.quotePipeline}</h2>
        {customer.quotes.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            {tc.noQuotes}
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {customer.quotes.map((quote) => (
              <li
                key={quote.id}
                className="rounded-[var(--radius-sm)] border px-3 py-2"
                style={{ borderColor: "var(--border)" }}
              >
                {quote.quoteNumber} • {quote.status} • {fmt(quote.total)} • {tc.reminders} {quote.reminderCount}
                {quote.validUntil
                  ? ` • ${tc.validUntil} ${new Date(quote.validUntil).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-EG")}`
                  : ""}
                {quote.lastReminderAt
                  ? ` • ${tc.lastReminder} ${new Date(quote.lastReminderAt).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-EG")}`
                  : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="app-card mb-6 p-4">
        <h2 className="mb-3 text-base font-semibold">{tc.repairTickets}</h2>
        {customer.repairTickets.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            {tc.noRepairs}
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {customer.repairTickets.map((ticket) => (
              <li
                key={ticket.id}
                className="rounded-[var(--radius-sm)] border px-3 py-2"
                style={{ borderColor: "var(--border)" }}
              >
                <p>
                  {ticket.ticketNumber} • {ticket.status}
                  {ticket.finalCost != null ? ` • ${fmt(ticket.finalCost)}` : ""}
                  {" • "}
                  {new Date(ticket.createdAt).toLocaleString(lang === "ar" ? "ar-EG" : "en-EG")}
                </p>
                {ticket.notes.length > 0 ? (
                  <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                    {tc.latestNotes}:{" "}
                    {ticket.notes
                      .slice(0, 2)
                      .map((note) => `${note.user.name}: ${note.content}`)
                      .join(" | ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="app-card p-4">
        <h2 className="mb-3 text-base font-semibold">{tc.activityTimeline}</h2>
        {customer.activityLogs.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            {tc.noActivity}
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {customer.activityLogs.map((log) => (
              <li
                key={log.id}
                className="rounded-[var(--radius-sm)] border px-3 py-2"
                style={{ borderColor: "var(--border)" }}
              >
                {log.action}
                {log.tableName ? ` • ${log.tableName}` : ""}
                {log.recordId ? ` • ${log.recordId}` : ""}
                {" • "}
                {new Date(log.createdAt).toLocaleString(lang === "ar" ? "ar-EG" : "en-EG")}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
