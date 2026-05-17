"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  AppPage,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  SectionTitle,
  Select,
  StatusBadge,
} from "@/components/ui/primitives";
import { errorMessageFromJson, parseResponseJson } from "@/lib/parseResponseJson";
import { useLang } from "@/lib/i18n";

type Supplier = { id: string; name: string };
type Product = { id: string; name: string; sku: string };
type LocationRow = { id: string; name: string; branchId: string | null };
type PurchaseOrderRow = {
  id: string;
  poNumber: string;
  supplierName: string;
  status: string;
  total: number;
  createdAt: string;
};

export default function PurchasingPage() {
  const { t, lang } = useLang();
  const tp = t.purchasing;
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [receiveLocationId, setReceiveLocationId] = useState("");
  const [receiveUserId, setReceiveUserId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [productId, setProductId] = useState("");
  const [orderedQty, setOrderedQty] = useState("1");
  const [unitCost, setUnitCost] = useState("0");
  const [dueDate, setDueDate] = useState("");
  const [rows, setRows] = useState<Array<{ productId: string; label: string; orderedQty: number; unitCost: number }>>([]);
  const [status, setStatus] = useState("");
  const [pos, setPos] = useState<PurchaseOrderRow[]>([]);

  const fmt = (n: number) =>
    new Intl.NumberFormat(lang === "ar" ? "ar-EG" : "en-EG", { style: "currency", currency: "EGP" }).format(n);

  const load = useCallback(async () => {
    const [sRes, pRes, poRes, lRes] = await Promise.all([
      fetch("/api/suppliers"),
      fetch("/api/products"),
      fetch("/api/purchase-orders"),
      fetch("/api/locations"),
    ]);
    const [s, p, po, l] = await Promise.all([
      parseResponseJson<Supplier[]>(sRes),
      parseResponseJson<Product[]>(pRes),
      parseResponseJson<PurchaseOrderRow[]>(poRes),
      parseResponseJson<LocationRow[]>(lRes),
    ]);
    const locs = Array.isArray(l) ? l : [];
    setSuppliers(Array.isArray(s) ? s : []);
    setProducts(Array.isArray(p) ? p : []);
    setPos(Array.isArray(po) ? po : []);
    setLocations(locs);
    if (!receiveLocationId && locs.length > 0) {
      setReceiveLocationId(locs[0].id);
    }
  }, [receiveLocationId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const addItem = () => {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    setRows((prev) => [
      ...prev,
      {
        productId,
        label: `${product.name} (${product.sku})`,
        orderedQty: Number(orderedQty),
        unitCost: Number(unitCost),
      },
    ]);
    setProductId("");
    setOrderedQty("1");
    setUnitCost("0");
  };

  const submitPO = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supplierId || rows.length === 0) return;
    const res = await fetch("/api/purchase-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supplierId,
        items: rows.map((row) => ({
          productId: row.productId,
          orderedQty: row.orderedQty,
          unitCost: row.unitCost,
        })),
        dueDate: dueDate || undefined,
      }),
    });
    if (!res.ok) {
      const err = await parseResponseJson<{ message?: string }>(res);
      setStatus(errorMessageFromJson(err, t.errors.generic));
      return;
    }
    setStatus(tp.createPO);
    setSupplierId("");
    setRows([]);
    setDueDate("");
    await load();
  };

  const receivePO = async (id: string) => {
    if (!receiveLocationId) {
      setStatus(tp.selectReceiveLocation);
      return;
    }
    const res = await fetch(`/api/purchase-orders/${id}/receive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        locationId: receiveLocationId,
        userId: receiveUserId || undefined,
      }),
    });
    if (!res.ok) {
      const err = await parseResponseJson<{ message?: string }>(res);
      setStatus(errorMessageFromJson(err, t.errors.generic));
      return;
    }
    setStatus(tp.receiveOrder);
    await load();
  };

  return (
    <AppPage>
      <PageHeader title={tp.title} subtitle={tp.subtitle} />

      <Card className="mb-6">
        <SectionTitle title={tp.createPO} />
        <form onSubmit={submitPO} className="space-y-3">
          <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="w-full" required>
            <option value="">{tp.selectSupplier}</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>

          <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
            <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">{tp.selectProduct}</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.sku})
                </option>
              ))}
            </Select>
            <Input type="number" min="1" value={orderedQty} onChange={(e) => setOrderedQty(e.target.value)} />
            <Input type="number" min="0" step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
            <Button type="button" variant="secondary" onClick={addItem}>
              {tp.addItem}
            </Button>
          </div>
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />

          {rows.length > 0 ? (
            <ul className="space-y-1 rounded border p-2 text-sm" style={{ borderColor: "var(--border)" }}>
              {rows.map((row, i) => (
                <li key={`${row.productId}-${i}`}>
                  {row.label} x {row.orderedQty} @ {row.unitCost.toFixed(2)}
                </li>
              ))}
            </ul>
          ) : null}

          <Button type="submit">{tp.createPO}</Button>
        </form>
        {status ? <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>{status}</p> : null}
      </Card>

      <Card>
        <SectionTitle title={tp.recentOrders} subtitle={`${pos.length}`} />
        <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-2">
          <Select
            value={receiveLocationId}
            onChange={(e) => setReceiveLocationId(e.target.value)}
          >
            <option value="">{tp.selectReceiveLocation}</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </Select>
          <Input
            value={receiveUserId}
            onChange={(e) => setReceiveUserId(e.target.value)}
            placeholder="User ID (optional)"
          />
        </div>
        {pos.length === 0 ? <EmptyState title={tp.noOrders} /> : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] border-collapse text-sm">
            <thead>
              <tr className="border-b text-start" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                <th className="px-2 py-2 font-medium text-start">{tp.colPoNumber}</th>
                <th className="px-2 py-2 font-medium text-start">{tp.colSupplier}</th>
                <th className="px-2 py-2 font-medium text-start">{tp.colStatus}</th>
                <th className="px-2 py-2 font-medium text-start">{tp.colTotal}</th>
                <th className="px-2 py-2 font-medium text-start">{tp.colCreated}</th>
                <th className="px-2 py-2 font-medium text-start">{tp.colDetail}</th>
                <th className="px-2 py-2 font-medium text-start">{tp.colActions}</th>
              </tr>
            </thead>
            <tbody>
              {pos.map((po) => (
                <tr key={po.id} className="border-b" style={{ borderColor: "var(--border)" }}>
                  <td className="px-2 py-2">{po.poNumber}</td>
                  <td className="px-2 py-2">{po.supplierName}</td>
                  <td className="px-2 py-2">
                    <StatusBadge
                      tone={
                        po.status === "RECEIVED"
                          ? "success"
                          : po.status === "CANCELLED"
                            ? "danger"
                            : po.status === "PARTIAL"
                              ? "warning"
                              : "neutral"
                      }
                    >
                      {po.status}
                    </StatusBadge>
                  </td>
                  <td className="px-2 py-2">{fmt(Number(po.total))}</td>
                  <td className="px-2 py-2">
                    {new Date(po.createdAt).toLocaleString(lang === "ar" ? "ar-EG" : "en-EG")}
                  </td>
                  <td className="px-2 py-2">
                    <Link href={`/purchasing/${po.id}`} className="app-btn app-btn-secondary py-1 text-xs">
                      {tp.open}
                    </Link>
                  </td>
                  <td className="px-2 py-2">
                    <Button
                      type="button"
                      onClick={() => { void receivePO(po.id); }}
                      disabled={po.status === "RECEIVED" || po.status === "CANCELLED"}
                      variant="secondary"
                      className="px-2 py-1 text-xs"
                    >
                      {tp.receive}
                    </Button>
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
