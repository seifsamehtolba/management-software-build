"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { AppPage, Button, Card, EmptyState, Input, PageHeader, SectionTitle, Select, StatusBadge } from "@/components/ui/primitives";
import { SuggestInput, type SuggestItem } from "@/components/ui/SuggestInput";
import { errorMessageFromJson, parseResponseJson } from "@/lib/parseResponseJson";
import { useLang } from "@/lib/i18n";

type RepairRow = {
  id: string;
  ticketNumber: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  deviceName: string;
  issueDesc: string;
  status: string;
  estimatedCost: number | null;
  finalCost: number | null;
  createdAt: string;
};

type CustomerLite = { id: string; name: string; phone: string };

export default function RepairsPage() {
  const { t, lang } = useLang();
  const tr = t.repairs;
  const router = useRouter();
  const [rows, setRows] = useState<RepairRow[]>([]);
  const [customers, setCustomers] = useState<CustomerLite[]>([]);
  const [query, setQuery] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [issueDesc, setIssueDesc] = useState("");
  const [estimatedCost, setEstimatedCost] = useState("0");
  const [status, setStatus] = useState("");

  const fmt = (n: number) =>
    new Intl.NumberFormat(lang === "ar" ? "ar-EG" : "en-EG", { style: "currency", currency: "EGP" }).format(n);

  const load = useCallback(async (q?: string) => {
    const repairsRes = await fetch(q ? `/api/repairs?q=${encodeURIComponent(q)}` : "/api/repairs");
    const customerRes = await fetch("/api/seed/customers");
    const [repairRows, customerRows] = await Promise.all([
      parseResponseJson<RepairRow[]>(repairsRes),
      parseResponseJson<CustomerLite[]>(customerRes),
    ]);
    setRows(Array.isArray(repairRows) ? repairRows : []);
    setCustomers(Array.isArray(customerRows) ? customerRows : []);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(query), 350);
    return () => clearTimeout(timer);
  }, [query, load]);

  const loadRepairSuggest = useCallback(async (q: string, signal: AbortSignal): Promise<SuggestItem[]> => {
    const url = q.trim() ? `/api/repairs?q=${encodeURIComponent(q.trim())}` : "/api/repairs";
    const res = await fetch(url, { signal });
    if (!res.ok) return [];
    const repairRows = await parseResponseJson<RepairRow[]>(res);
    if (!Array.isArray(repairRows)) return [];
    return repairRows.slice(0, 12).map((r) => ({
      id: r.id,
      label: r.ticketNumber,
      description: `${r.customerName} · ${r.deviceName}`,
      data: r,
    }));
  }, []);

  const createTicket = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const res = await fetch("/api/repairs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId,
        deviceName,
        issueDesc,
        estimatedCost: Number(estimatedCost),
      }),
    });
    if (!res.ok) {
      const err = await parseResponseJson<{ message?: string }>(res);
      setStatus(errorMessageFromJson(err, t.errors.generic));
      return;
    }
    setStatus(tr.newTicket);
    setCustomerId("");
    setDeviceName("");
    setIssueDesc("");
    setEstimatedCost("0");
    await load(query);
  };

  const updateStatus = async (id: string, nextStatus: string) => {
    await fetch(`/api/repairs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
    await load(query);
  };

  return (
    <AppPage>
      <PageHeader title={tr.title} subtitle={tr.subtitle} />

      <Card className="mb-6">
        <SectionTitle title={tr.createTicket} />
        <form onSubmit={createTicket} className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
            <option value="">{tr.selectCustomer}</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} - {c.phone}
              </option>
            ))}
          </Select>
          <Input
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            placeholder={tr.deviceNamePlaceholder}
            required
          />
          <Input
            value={issueDesc}
            onChange={(e) => setIssueDesc(e.target.value)}
            placeholder={tr.issuePlaceholder}
            required
          />
          <Input
            type="number"
            min="0"
            step="0.01"
            value={estimatedCost}
            onChange={(e) => setEstimatedCost(e.target.value)}
            placeholder={tr.estCostPlaceholder}
          />
          <Button type="submit">{tr.createTicketBtn}</Button>
        </form>
        {status ? (
          <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
            {status}
          </p>
        ) : null}
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <SectionTitle title={tr.ticketsSection} />
          <SuggestInput
            value={query}
            onChange={setQuery}
            loadSuggestions={loadRepairSuggest}
            onPick={(item) => {
              const row = item.data as RepairRow;
              router.push(`/repairs/${row.id}`);
            }}
            placeholder={tr.searchPlaceholder}
            className="ms-auto w-full max-w-sm"
            minChars={1}
          />
          <Button type="button" variant="secondary" onClick={() => void load(query)}>
            {tr.refresh}
          </Button>
        </div>
        {rows.length === 0 ? <EmptyState title={tr.noTickets} /> : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] border-collapse text-sm">
            <thead>
              <tr className="border-b text-start" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                <th className="px-2 py-2 font-medium text-start">{tr.colTicket}</th>
                <th className="px-2 py-2 font-medium text-start">{tr.colCustomer}</th>
                <th className="px-2 py-2 font-medium text-start">{tr.colDevice}</th>
                <th className="px-2 py-2 font-medium text-start">{tr.colIssue}</th>
                <th className="px-2 py-2 font-medium text-start">{tr.colStatus}</th>
                <th className="px-2 py-2 font-medium text-start">{tr.colEst}</th>
                <th className="px-2 py-2 font-medium text-start">{tr.colDetail}</th>
                <th className="px-2 py-2 font-medium text-start">{tr.colActions}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b" style={{ borderColor: "var(--border)" }}>
                  <td className="px-2 py-2">{row.ticketNumber}</td>
                  <td className="px-2 py-2">
                    {row.customerName}
                    <div style={{ color: "var(--muted)" }}>{row.customerPhone}</div>
                  </td>
                  <td className="px-2 py-2">{row.deviceName}</td>
                  <td className="px-2 py-2">{row.issueDesc}</td>
                  <td className="px-2 py-2">
                    <StatusBadge
                      tone={
                        row.status === "READY" || row.status === "DELIVERED"
                          ? "success"
                          : row.status === "CANCELLED"
                            ? "danger"
                            : row.status === "WAITING_PARTS"
                              ? "warning"
                              : "neutral"
                      }
                    >
                      {row.status}
                    </StatusBadge>
                  </td>
                  <td className="px-2 py-2">
                    {row.estimatedCost != null ? fmt(row.estimatedCost) : "-"}
                  </td>
                  <td className="px-2 py-2">
                    <Link href={`/repairs/${row.id}`} className="app-btn app-btn-secondary py-1 text-xs">
                      {tr.open}
                    </Link>
                  </td>
                  <td className="px-2 py-2">
                    <Select
                      value={row.status}
                      onChange={(e) => void updateStatus(row.id, e.target.value)}
                    >
                      <option value="RECEIVED">{tr.statusReceived}</option>
                      <option value="DIAGNOSING">{tr.statusDiagnosing}</option>
                      <option value="WAITING_PARTS">{tr.statusWaitingParts}</option>
                      <option value="IN_REPAIR">{tr.statusInRepair}</option>
                      <option value="READY">{tr.statusReady}</option>
                      <option value="DELIVERED">{tr.statusDelivered}</option>
                    </Select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </AppPage>
  );
}
