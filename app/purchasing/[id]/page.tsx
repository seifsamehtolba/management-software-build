"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { parseResponseJson } from "@/lib/parseResponseJson";
import { useLang } from "@/lib/i18n";

type POItem = {
  id: string;
  orderedQty: number;
  receivedQty: number;
  unitCost: number;
  total: number;
  product: { id: string; name: string; sku: string };
};

type PODetails = {
  id: string;
  poNumber: string;
  status: string;
  supplier: { id: string; name: string; phone?: string | null };
  subtotal: number;
  taxAmount: number;
  total: number;
  paidAmount: number;
  createdAt: string;
  expectedDate: string | null;
  dueDate: string | null;
  receivedDate: string | null;
  items: POItem[];
};

export default function PurchaseOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const { t, lang } = useLang();
  const tp = t.purchasing;
  const [po, setPo] = useState<PODetails | null>(null);

  useEffect(() => {
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/purchase-orders/${params.id}`);
      if (!res.ok) return;
      const data = await parseResponseJson<PODetails>(res);
      if (data) setPo(data);
    }, 0);
    return () => clearTimeout(timer);
  }, [params.id]);

  if (!po) {
    return (
      <main className="p-6 text-sm" style={{ color: "var(--muted)" }}>
        {tp.loadingOrder}
      </main>
    );
  }

  const fmt = (n: number) =>
    new Intl.NumberFormat(lang === "ar" ? "ar-EG" : "en-EG", { style: "currency", currency: "EGP" }).format(n);

  return (
    <main className="animate-fade-in p-6">
      <h1 className="mb-1 text-2xl font-semibold">{po.poNumber}</h1>
      <p className="mb-4 text-sm" style={{ color: "var(--muted)" }}>
        {po.supplier.name} • {po.status} • {t.labels.total} {fmt(po.total)}
        {po.dueDate ? ` • Due ${new Date(po.dueDate).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-EG")}` : ""}
      </p>

      <section className="app-card p-4">
        <h2 className="mb-3 text-base font-semibold">{tp.items}</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] border-collapse text-sm">
            <thead>
              <tr className="border-b text-start" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                <th className="px-2 py-2 font-medium text-start">{tp.colProduct}</th>
                <th className="px-2 py-2 font-medium text-start">{tp.colOrdered}</th>
                <th className="px-2 py-2 font-medium text-start">{tp.colReceived}</th>
                <th className="px-2 py-2 font-medium text-start">{tp.colUnitCost}</th>
                <th className="px-2 py-2 font-medium text-start">{tp.colTotal}</th>
              </tr>
            </thead>
            <tbody>
              {po.items.map((item) => (
                <tr key={item.id} className="border-b" style={{ borderColor: "var(--border)" }}>
                  <td className="px-2 py-2">
                    {item.product.name} ({item.product.sku})
                  </td>
                  <td className="px-2 py-2">{item.orderedQty}</td>
                  <td className="px-2 py-2">{item.receivedQty}</td>
                  <td className="px-2 py-2">{fmt(item.unitCost)}</td>
                  <td className="px-2 py-2">{fmt(item.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
