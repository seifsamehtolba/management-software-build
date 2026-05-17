"use client";

import { useEffect, useState } from "react";
import { AppPage, Button, Card, EmptyState, Input, PageHeader, SectionTitle } from "@/components/ui/primitives";
import { parseResponseJson } from "@/lib/parseResponseJson";

type AuditRow = {
  id: string;
  action: string;
  tableName: string | null;
  recordId: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
  user: { id: string; name: string; email: string };
};

export default function AuditPage() {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      const response = await fetch(`/api/audit?${params.toString()}`);
      if (!response.ok) return;
      const payload = await parseResponseJson<{ rows: AuditRow[] }>(response);
      setRows(payload?.rows ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <AppPage>
      <PageHeader title="Audit Trail" subtitle="Explore sensitive operations across stock, payroll, finance, and approvals." />
      <Card className="mb-6">
        <SectionTitle title="Filters" />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[2fr_auto]">
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by action, table, record, or user" />
          <Button type="button" variant="secondary" onClick={() => void load()}>Refresh</Button>
        </div>
      </Card>
      <Card>
        <SectionTitle title="Activity" subtitle={`${rows.length}`} />
        {loading ? <p className="text-sm" style={{ color: "var(--muted)" }}>Loading activity...</p> : null}
        {!loading && rows.length === 0 ? <EmptyState title="No audit events found." /> : null}
        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row.id} className="rounded-xl border p-4" style={{ borderColor: "var(--border)" }}>
              <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="font-semibold">{row.action}</p>
                  <p className="text-sm" style={{ color: "var(--muted)" }}>
                    {row.tableName ?? "—"} · {row.recordId ?? "—"} · {row.user.name}
                  </p>
                </div>
                <p className="text-sm" style={{ color: "var(--muted)" }}>
                  {new Date(row.createdAt).toLocaleString()}
                </p>
              </div>
              {row.details ? (
                <pre className="mt-3 overflow-auto rounded-lg border p-3 text-xs" style={{ borderColor: "var(--border)", background: "var(--surface-muted)" }}>
                  {JSON.stringify(row.details, null, 2)}
                </pre>
              ) : null}
            </div>
          ))}
        </div>
      </Card>
    </AppPage>
  );
}
