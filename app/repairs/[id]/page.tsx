"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { parseResponseJson } from "@/lib/parseResponseJson";
import { useLang } from "@/lib/i18n";

type RepairDetails = {
  id: string;
  ticketNumber: string;
  status: string;
  deviceName: string;
  issueDesc: string;
  customer: { id: string; name: string; phone: string };
  estimatedCost: number | null;
  finalCost: number | null;
  createdAt: string;
  updatedAt: string;
};

export default function RepairDetailPage() {
  const params = useParams<{ id: string }>();
  const { t, lang } = useLang();
  const tr = t.repairs;
  const [ticket, setTicket] = useState<RepairDetails | null>(null);

  useEffect(() => {
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/repairs/${params.id}`);
      if (!res.ok) return;
      const data = await parseResponseJson<RepairDetails>(res);
      if (data) setTicket(data);
    }, 0);
    return () => clearTimeout(timer);
  }, [params.id]);

  if (!ticket) {
    return (
      <main className="p-6 text-sm" style={{ color: "var(--muted)" }}>
        {tr.loadingTicket}
      </main>
    );
  }

  const fmt = (n: number) =>
    new Intl.NumberFormat(lang === "ar" ? "ar-EG" : "en-EG", { style: "currency", currency: "EGP" }).format(n);

  return (
    <main className="animate-fade-in p-6">
      <h1 className="mb-1 text-2xl font-semibold">{ticket.ticketNumber}</h1>
      <p className="mb-4 text-sm" style={{ color: "var(--muted)" }}>
        {ticket.status} • {ticket.deviceName} • {ticket.customer.name} ({ticket.customer.phone})
      </p>
      <section className="app-card p-4">
        <p className="mb-2 text-sm">
          <span className="font-medium">{tr.ticketIssue}</span> {ticket.issueDesc}
        </p>
        <p className="mb-2 text-sm">
          <span className="font-medium">{tr.ticketEst}</span>{" "}
          {ticket.estimatedCost != null ? fmt(ticket.estimatedCost) : "-"}
        </p>
        <p className="mb-2 text-sm">
          <span className="font-medium">{tr.ticketFinal}</span>{" "}
          {ticket.finalCost != null ? fmt(ticket.finalCost) : "-"}
        </p>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          {tr.ticketCreated} {new Date(ticket.createdAt).toLocaleString(lang === "ar" ? "ar-EG" : "en-EG")} •{" "}
          {tr.ticketUpdated} {new Date(ticket.updatedAt).toLocaleString(lang === "ar" ? "ar-EG" : "en-EG")}
        </p>
      </section>
    </main>
  );
}
