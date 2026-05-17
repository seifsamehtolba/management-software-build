"use client";

import { FormEvent, Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { AddProductModal } from "@/components/inventory/AddProductModal";
import { AppPage, Button, Card, EmptyState, Input, PageHeader, SectionTitle, StatusBadge } from "@/components/ui/primitives";
import { SuggestInput, type SuggestItem } from "@/components/ui/SuggestInput";
import { errorMessageFromJson, parseResponseJson } from "@/lib/parseResponseJson";
import { useLang } from "@/lib/i18n";

type ProductRow = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  categoryId: string;
  categoryName: string;
  brandId: string | null;
  brandName: string | null;
  costPrice: number;
  sellPrice: number;
  taxRate: number;
  hasSerials: boolean;
  isActive: boolean;
  componentCategory: string | null;
  specs: Record<string, string> | null;
  externalRef: string | null;
  suggestedPriceUsd: number | null;
  imageUrl: string | null;
  updatedAt: string;
};

type ProductForm = {
  sku: string;
  barcode: string;
  name: string;
  categoryId: string;
  brandId: string;
  costPrice: string;
  sellPrice: string;
  taxRate: string;
  hasSerials: boolean;
};

type CategoryOption = { id: string; name: string; nameAr: string | null };
type BrandOption = { id: string; name: string };
type StockRow = { id: string; productId: string; locationId: string; quantity: number };
type LocationRow = { id: string; name: string; branchId: string | null };
type BranchRow = { id: string; name: string };
type TransferRow = {
  id: string;
  transferNumber: string;
  status: string;
  notes: string | null;
  fromBranch: { id: string; name: string };
  toBranch: { id: string; name: string };
  fromLocation: { id: string; name: string };
  toLocation: { id: string; name: string };
  createdAt: string;
  shippedAt: string | null;
  receivedAt: string | null;
  items: Array<{
    id: string;
    product: { id: string; name: string; sku: string };
    quantity: number;
    shippedQty: number;
    receivedQty: number;
  }>;
};
type ReorderRow = {
  productId: string;
  productName: string;
  sku: string;
  locationName: string;
  onHand: number;
  reorderPoint: number;
  sold45Days: number;
  dailyRunRate: number;
  recommendedQty: number;
  gapQty: number;
  estimatedBuyCost: number;
  estimatedRevenue: number;
};

const defaultForm: ProductForm = {
  sku: "",
  barcode: "",
  name: "",
  categoryId: "",
  brandId: "",
  costPrice: "0",
  sellPrice: "0",
  taxRate: "0.14",
  hasSerials: false,
};

export default function InventoryPage() {
  const { t } = useLang();
  const ti = t.inventory;
  const [addMode, setAddMode] = useState<"search" | "manual">("search");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [form, setForm] = useState<ProductForm>(defaultForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [stockRows, setStockRows] = useState<StockRow[]>([]);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const [newWarehouseName, setNewWarehouseName] = useState("");
  const [newWarehouseBranchId, setNewWarehouseBranchId] = useState("");
  const [creatingWarehouse, setCreatingWarehouse] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newBrandName, setNewBrandName] = useState("");
  const [adjustingProductId, setAdjustingProductId] = useState<string | null>(null);
  const [adjustLocationId, setAdjustLocationId] = useState("");
  const [adjustDelta, setAdjustDelta] = useState("1");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [reorderRows, setReorderRows] = useState<ReorderRow[]>([]);
  const [transferForm, setTransferForm] = useState({
    fromLocationId: "",
    toLocationId: "",
    productId: "",
    quantity: "1",
    notes: "",
  });

  const formTitle = useMemo(() => (editingId ? ti.editProduct : ti.createProduct), [editingId, ti]);

  const loadProducts = async (q?: string) => {
    setLoading(true);
    const url = q?.trim() ? `/api/products?q=${encodeURIComponent(q.trim())}` : "/api/products";
    const res = await fetch(url);
    const data = await parseResponseJson<ProductRow[]>(res);
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  const loadOptions = useCallback(async () => {
    const [catRes, brandRes, locationRes, stockRes, branchRes, transferRes, reorderRes] = await Promise.all([
      fetch("/api/categories"),
      fetch("/api/brands"),
      fetch("/api/locations"),
      fetch("/api/seed/stock"),
      fetch("/api/branches"),
      fetch("/api/stock/transfers"),
      fetch("/api/reorder-recommendations"),
    ]);
    const [catRows, brandRows] = await Promise.all([
      parseResponseJson<CategoryOption[]>(catRes),
      parseResponseJson<BrandOption[]>(brandRes),
    ]);
    const [locationRows, stockRowsData, branchRows, transferRows, reorderPayload] = await Promise.all([
      parseResponseJson<LocationRow[]>(locationRes),
      parseResponseJson<StockRow[]>(stockRes),
      parseResponseJson<BranchRow[]>(branchRes),
      parseResponseJson<TransferRow[]>(transferRes),
      parseResponseJson<{ rows: ReorderRow[] }>(reorderRes),
    ]);
    const safeCats = Array.isArray(catRows) ? catRows : [];
    const safeBrands = Array.isArray(brandRows) ? brandRows : [];
    const safeLocs = Array.isArray(locationRows) ? locationRows : [];
    const safeStock = Array.isArray(stockRowsData) ? stockRowsData : [];
    const safeBranches = Array.isArray(branchRows) ? branchRows : [];
    setCategories(safeCats);
    setBrands(safeBrands);
    setLocations(safeLocs);
    setStockRows(safeStock);
    setBranches(safeBranches);
    setTransfers(Array.isArray(transferRows) ? transferRows : []);
    setReorderRows(reorderPayload?.rows ?? []);
    if (!adjustLocationId && safeLocs.length > 0) {
      setAdjustLocationId(safeLocs[0].id);
    }
    if (!transferForm.fromLocationId && safeLocs.length > 0) {
      setTransferForm((current) => ({
        ...current,
        fromLocationId: current.fromLocationId || safeLocs[0].id,
        toLocationId: current.toLocationId || safeLocs[Math.min(1, safeLocs.length - 1)]?.id || "",
      }));
    }
  }, [adjustLocationId, transferForm.fromLocationId]);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    const timer = setTimeout(() => void loadProducts(query), 350);
    return () => clearTimeout(timer);
  }, [query]);

  const loadInventorySuggestions = useCallback(async (q: string, signal: AbortSignal): Promise<SuggestItem[]> => {
    const url = q.trim() ? `/api/products?q=${encodeURIComponent(q.trim())}` : "/api/products";
    const res = await fetch(url, { signal });
    if (!res.ok) return [];
    const rowList = await parseResponseJson<ProductRow[]>(res);
    if (!Array.isArray(rowList)) return [];
    return rowList.slice(0, 12).map((r) => ({
      id: r.id,
      label: r.name,
      description: `${r.sku}${r.barcode ? ` · ${r.barcode}` : ""} · EGP ${r.sellPrice.toFixed(2)}`,
      data: r,
    }));
  }, []);

  const resetForm = () => {
    setForm(defaultForm);
    setEditingId(null);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setStatus("");

    try {
      const payload = {
        sku: form.sku,
        barcode: form.barcode || null,
        name: form.name,
        categoryId: form.categoryId,
        brandId: form.brandId || null,
        costPrice: Number(form.costPrice),
        sellPrice: Number(form.sellPrice),
        taxRate: Number(form.taxRate),
        hasSerials: form.hasSerials,
      };

      const res = await fetch(editingId ? `/api/products/${editingId}` : "/api/products", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await parseResponseJson<{ message?: string }>(res);
        throw new Error(errorMessageFromJson(err, t.errors.generic));
      }

      setStatus(editingId ? ti.editProduct : ti.createProduct);
      resetForm();
      await loadProducts(query);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(t.errors.generic);
      setStatus(err.message);
    } finally {
      setSaving(false);
    }
  };

  const onEdit = (row: ProductRow) => {
    setEditingId(row.id);
    setForm({
      sku: row.sku,
      barcode: row.barcode ?? "",
      name: row.name,
      categoryId: row.categoryId,
      brandId: row.brandId ?? "",
      costPrice: row.costPrice.toString(),
      sellPrice: row.sellPrice.toString(),
      taxRate: row.taxRate.toString(),
      hasSerials: row.hasSerials,
    });
  };

  const onDelete = async (id: string) => {
    const ok = confirm(ti.archive + "?");
    if (!ok) return;
    await fetch(`/api/products/${id}`, { method: "DELETE" });
    await loadProducts(query);
  };

  const totalStockByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const stock of stockRows) {
      if (warehouseFilter && stock.locationId !== warehouseFilter) continue;
      map.set(stock.productId, (map.get(stock.productId) ?? 0) + stock.quantity);
    }
    return map;
  }, [stockRows, warehouseFilter]);

  const locationStockLabel = (productId: string) => {
    const relevant = stockRows.filter(
      (row) =>
        row.productId === productId &&
        row.quantity !== 0 &&
        (!warehouseFilter || row.locationId === warehouseFilter),
    );
    if (relevant.length === 0) return ti.noStockRecords;
    return relevant
      .slice(0, 3)
      .map((row) => {
        const location = locations.find((l) => l.id === row.locationId);
        return `${location?.name ?? row.locationId}: ${row.quantity}`;
      })
      .join(" • ");
  };

  const createWarehouse = async () => {
    if (!newWarehouseName.trim()) return;
    setCreatingWarehouse(true);
    setStatus("");
    try {
      const res = await fetch("/api/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newWarehouseName.trim(),
          branchId: newWarehouseBranchId || null,
        }),
      });
      const data = await parseResponseJson<LocationRow | { message?: string }>(res);
      if (!res.ok) {
        throw new Error(errorMessageFromJson(data, t.errors.generic));
      }
      if (!data || !("id" in data) || !("name" in data)) {
        throw new Error(t.errors.generic);
      }
      const created = data as LocationRow;
      setLocations((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setWarehouseFilter(created.id);
      setAdjustLocationId(created.id);
      setNewWarehouseName("");
      setNewWarehouseBranchId("");
      setStatus(ti.createWarehouse);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(t.errors.generic);
      setStatus(err.message);
    } finally {
      setCreatingWarehouse(false);
    }
  };

  const submitAdjustStock = async () => {
    if (!adjustingProductId) return;
    const delta = Number(adjustDelta);
    if (!adjustLocationId || !Number.isInteger(delta) || delta === 0) {
      setStatus(t.errors.generic);
      return;
    }
    setAdjusting(true);
    setStatus("");
    try {
      const res = await fetch("/api/stock/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: adjustingProductId,
          locationId: adjustLocationId,
          delta,
          reason: adjustReason || "Manual adjustment from inventory page",
        }),
      });
      const data = await parseResponseJson<{ message?: string }>(res);
      if (!res.ok) {
        throw new Error(errorMessageFromJson(data, t.errors.generic));
      }
      setStatus(ti.adjustStock);
      setAdjustingProductId(null);
      setAdjustReason("");
      setAdjustDelta("1");
      await loadOptions();
      await loadProducts(query);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(t.errors.generic);
      setStatus(err.message);
    } finally {
      setAdjusting(false);
    }
  };

  const createTransfer = async () => {
    const fromLocation = locations.find((location) => location.id === transferForm.fromLocationId);
    const toLocation = locations.find((location) => location.id === transferForm.toLocationId);
    const quantity = Number(transferForm.quantity);
    if (!fromLocation || !toLocation || !transferForm.productId || !Number.isInteger(quantity) || quantity <= 0) {
      setStatus(t.errors.generic);
      return;
    }
    const res = await fetch("/api/stock/transfers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromBranchId: fromLocation.branchId,
        toBranchId: toLocation.branchId,
        fromLocationId: fromLocation.id,
        toLocationId: toLocation.id,
        notes: transferForm.notes || undefined,
        items: [{ productId: transferForm.productId, quantity }],
      }),
    });
    const data = await parseResponseJson<{ message?: string }>(res);
    if (!res.ok) {
      setStatus(errorMessageFromJson(data, t.errors.generic));
      return;
    }
    setStatus("Transfer created.");
    setTransferForm((current) => ({ ...current, productId: "", quantity: "1", notes: "" }));
    await loadOptions();
  };

  const shipTransfer = async (id: string) => {
    const res = await fetch(`/api/stock/transfers/${id}/ship`, { method: "POST" });
    const data = await parseResponseJson<{ message?: string }>(res);
    if (!res.ok) {
      setStatus(errorMessageFromJson(data, t.errors.generic));
      return;
    }
    setStatus("Transfer shipped.");
    await loadOptions();
  };

  const receiveTransfer = async (id: string) => {
    const res = await fetch(`/api/stock/transfers/${id}/receive`, { method: "POST" });
    const data = await parseResponseJson<{ message?: string }>(res);
    if (!res.ok) {
      setStatus(errorMessageFromJson(data, t.errors.generic));
      return;
    }
    setStatus("Transfer received.");
    await loadOptions();
  };

  const createCategory = async () => {
    if (!newCategoryName.trim()) return;
    const res = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newCategoryName }),
    });
    if (!res.ok) return;
    const created = await parseResponseJson<CategoryOption>(res);
    if (!created) return;
    setCategories((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
    setForm((prev) => ({ ...prev, categoryId: created.id }));
    setNewCategoryName("");
  };

  const createBrand = async () => {
    if (!newBrandName.trim()) return;
    const res = await fetch("/api/brands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newBrandName }),
    });
    if (!res.ok) return;
    const created = await parseResponseJson<BrandOption>(res);
    if (!created) return;
    setBrands((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
    setForm((prev) => ({ ...prev, brandId: created.id }));
    setNewBrandName("");
  };

  return (
    <AppPage>
      <PageHeader title={ti.title} subtitle={ti.subtitle} />

      <Card className="mb-6">
        <SectionTitle title={ti.warehouses} subtitle={ti.warehousesSubtitle} />
        <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-[2fr_1.2fr_auto]">
          <Input
            value={newWarehouseName}
            onChange={(e) => setNewWarehouseName(e.target.value)}
            placeholder={ti.newWarehouseName}
          />
          <select
            value={newWarehouseBranchId}
            onChange={(e) => setNewWarehouseBranchId(e.target.value)}
            className="rounded border px-3 py-2 text-sm"
            style={{ borderColor: "var(--border)" }}
          >
            <option value="">{ti.noBranch}</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
          <Button type="button" onClick={() => void createWarehouse()} disabled={creatingWarehouse}>
            {creatingWarehouse ? ti.creating : ti.createWarehouse}
          </Button>
        </div>
        <div className="mb-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setWarehouseFilter("")}
            className={`rounded border px-3 py-1 text-sm ${
              warehouseFilter === "" ? "border-transparent text-white" : "hover:bg-zinc-50"
            }`}
            style={{
              borderColor: warehouseFilter === "" ? "transparent" : "var(--border)",
              background: warehouseFilter === "" ? "var(--accent)" : undefined,
            }}
          >
            {ti.allWarehouses}
          </button>
          {locations.map((location) => (
            <button
              key={location.id}
              type="button"
              onClick={() => setWarehouseFilter(location.id)}
              className={`rounded border px-3 py-1 text-sm ${
                warehouseFilter === location.id ? "border-transparent text-white" : "hover:bg-zinc-50"
              }`}
              style={{
                borderColor: warehouseFilter === location.id ? "transparent" : "var(--border)",
                background: warehouseFilter === location.id ? "var(--accent)" : undefined,
              }}
            >
              {location.name}
            </button>
          ))}
        </div>
      </Card>

      <Card className="mb-6">
        <SectionTitle title="Branch transfers" subtitle="Request, ship, and receive stock between branches." />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_1fr_140px_auto]">
          <select
            value={transferForm.fromLocationId}
            onChange={(e) => setTransferForm((current) => ({ ...current, fromLocationId: e.target.value }))}
            className="rounded border px-3 py-2 text-sm"
            style={{ borderColor: "var(--border)" }}
          >
            <option value="">From location</option>
            {locations.map((location) => (
              <option key={`from-${location.id}`} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
          <select
            value={transferForm.toLocationId}
            onChange={(e) => setTransferForm((current) => ({ ...current, toLocationId: e.target.value }))}
            className="rounded border px-3 py-2 text-sm"
            style={{ borderColor: "var(--border)" }}
          >
            <option value="">To location</option>
            {locations.map((location) => (
              <option key={`to-${location.id}`} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
          <select
            value={transferForm.productId}
            onChange={(e) => setTransferForm((current) => ({ ...current, productId: e.target.value }))}
            className="rounded border px-3 py-2 text-sm"
            style={{ borderColor: "var(--border)" }}
          >
            <option value="">Product</option>
            {rows.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name} ({product.sku})
              </option>
            ))}
          </select>
          <Input
            type="number"
            min="1"
            step="1"
            value={transferForm.quantity}
            onChange={(e) => setTransferForm((current) => ({ ...current, quantity: e.target.value }))}
            placeholder="Qty"
          />
          <Button type="button" onClick={() => void createTransfer()}>
            Create transfer
          </Button>
        </div>
        <Input
          className="mt-3"
          value={transferForm.notes}
          onChange={(e) => setTransferForm((current) => ({ ...current, notes: e.target.value }))}
          placeholder="Transfer note"
        />
        <div className="mt-4 space-y-3">
          {transfers.length === 0 ? (
            <EmptyState title="No transfers yet." />
          ) : (
            transfers.slice(0, 8).map((transfer) => (
              <div key={transfer.id} className="rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="font-medium">{transfer.transferNumber}</p>
                    <p className="text-sm" style={{ color: "var(--muted)" }}>
                      {transfer.fromLocation.name} {"->"} {transfer.toLocation.name}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge tone={transfer.status === "RECEIVED" ? "success" : transfer.status === "IN_TRANSIT" ? "warning" : "neutral"}>
                      {transfer.status}
                    </StatusBadge>
                    {transfer.status === "DRAFT" ? (
                      <Button type="button" variant="secondary" className="text-xs" onClick={() => void shipTransfer(transfer.id)}>
                        Ship
                      </Button>
                    ) : null}
                    {transfer.status === "IN_TRANSIT" ? (
                      <Button type="button" variant="secondary" className="text-xs" onClick={() => void receiveTransfer(transfer.id)}>
                        Receive
                      </Button>
                    ) : null}
                  </div>
                </div>
                <ul className="mt-2 space-y-1 text-sm">
                  {transfer.items.map((item) => (
                    <li key={item.id}>
                      {item.product.name} · requested {item.quantity} · shipped {item.shippedQty} · received {item.receivedQty}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      </Card>

      <Card className="mb-6">
        <SectionTitle title="Reorder intelligence" subtitle="Products likely to stock out within the next few weeks." />
        {reorderRows.length === 0 ? (
          <EmptyState title="No urgent reorders right now." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="border-b text-start" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                  <th className="px-2 py-2 font-medium text-start">Product</th>
                  <th className="px-2 py-2 font-medium text-start">Location</th>
                  <th className="px-2 py-2 font-medium text-start">On hand</th>
                  <th className="px-2 py-2 font-medium text-start">Sold 45d</th>
                  <th className="px-2 py-2 font-medium text-start">Recommended</th>
                  <th className="px-2 py-2 font-medium text-start">Gap</th>
                  <th className="px-2 py-2 font-medium text-start">Buy cost</th>
                </tr>
              </thead>
              <tbody>
                {reorderRows.slice(0, 10).map((row) => (
                  <tr key={`${row.productId}-${row.locationName}`} className="border-b" style={{ borderColor: "var(--border)" }}>
                    <td className="px-2 py-2">{row.productName}</td>
                    <td className="px-2 py-2">{row.locationName}</td>
                    <td className="px-2 py-2">{row.onHand}</td>
                    <td className="px-2 py-2">{row.sold45Days}</td>
                    <td className="px-2 py-2">{row.recommendedQty}</td>
                    <td className="px-2 py-2 font-semibold">{row.gapQty}</td>
                    <td className="px-2 py-2">EGP {row.estimatedBuyCost.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mb-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <SectionTitle title={ti.addToInventory} />
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={() => setAddMode("search")}
              variant={addMode === "search" ? "primary" : "secondary"}
            >
              {ti.importBySearch}
            </Button>
            <Button
              type="button"
              onClick={() => setAddMode("manual")}
              variant={addMode === "manual" ? "primary" : "secondary"}
            >
              {ti.addManually}
            </Button>
          </div>
        </div>
        {addMode === "search" ? (
          <div className="rounded border p-4" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            <p className="mb-3 text-sm" style={{ color: "var(--muted)" }}>
              {ti.importHint}
            </p>
            <AddProductModal
              onSuccess={() => {
                void loadProducts(query);
              }}
            />
          </div>
        ) : (
          <form onSubmit={onSubmit} className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="md:col-span-2 mb-1">
              <h3 className="text-base font-semibold">{formTitle}</h3>
            </div>
            <input
              value={form.sku}
              onChange={(e) => setForm((prev) => ({ ...prev, sku: e.target.value }))}
              placeholder={ti.skuPlaceholder}
              className="rounded border px-3 py-2 text-sm"
              style={{ borderColor: "var(--border)" }}
              required
            />
            <input
              value={form.barcode}
              onChange={(e) => setForm((prev) => ({ ...prev, barcode: e.target.value }))}
              placeholder={ti.barcodePlaceholder}
              className="rounded border px-3 py-2 text-sm"
              style={{ borderColor: "var(--border)" }}
            />
            <input
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder={ti.productNamePlaceholder}
              className="rounded border px-3 py-2 text-sm"
              style={{ borderColor: "var(--border)" }}
              required
            />
            <div className="space-y-2">
              <select
                value={form.categoryId}
                onChange={(e) => setForm((prev) => ({ ...prev, categoryId: e.target.value }))}
                className="w-full rounded border px-3 py-2 text-sm"
                style={{ borderColor: "var(--border)" }}
                required
              >
                <option value="">{ti.selectCategory}</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                <input
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder={ti.newCategoryName}
                  className="w-full rounded border px-3 py-2 text-sm"
                  style={{ borderColor: "var(--border)" }}
                />
                <button
                  type="button"
                  onClick={() => { void createCategory(); }}
                  className="rounded border px-3 py-2 text-sm"
                  style={{ borderColor: "var(--border)" }}
                >
                  {t.actions.add}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <select
                value={form.brandId}
                onChange={(e) => setForm((prev) => ({ ...prev, brandId: e.target.value }))}
                className="w-full rounded border px-3 py-2 text-sm"
                style={{ borderColor: "var(--border)" }}
              >
                <option value="">{ti.noBrand}</option>
                {brands.map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.name}
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                <input
                  value={newBrandName}
                  onChange={(e) => setNewBrandName(e.target.value)}
                  placeholder={ti.newBrandName}
                  className="w-full rounded border px-3 py-2 text-sm"
                  style={{ borderColor: "var(--border)" }}
                />
                <button
                  type="button"
                  onClick={() => { void createBrand(); }}
                  className="rounded border px-3 py-2 text-sm"
                  style={{ borderColor: "var(--border)" }}
                >
                  {t.actions.add}
                </button>
              </div>
            </div>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.costPrice}
              onChange={(e) => setForm((prev) => ({ ...prev, costPrice: e.target.value }))}
              placeholder={ti.costPricePlaceholder}
              className="rounded border px-3 py-2 text-sm"
              style={{ borderColor: "var(--border)" }}
              required
            />
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.sellPrice}
              onChange={(e) => setForm((prev) => ({ ...prev, sellPrice: e.target.value }))}
              placeholder={ti.sellPricePlaceholder}
              className="rounded border px-3 py-2 text-sm"
              style={{ borderColor: "var(--border)" }}
              required
            />
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.taxRate}
              onChange={(e) => setForm((prev) => ({ ...prev, taxRate: e.target.value }))}
              placeholder={ti.taxRatePlaceholder}
              className="rounded border px-3 py-2 text-sm"
              style={{ borderColor: "var(--border)" }}
              required
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.hasSerials}
                onChange={(e) => setForm((prev) => ({ ...prev, hasSerials: e.target.checked }))}
              />
              {ti.hasSerialNumbers}
            </label>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded px-4 py-2 text-sm text-white disabled:opacity-60"
                style={{ background: "var(--accent)" }}
              >
                {saving ? t.actions.saving : editingId ? t.actions.update : t.actions.create}
              </button>
              {editingId ? (
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded border px-4 py-2 text-sm"
                  style={{ borderColor: "var(--border)" }}
                >
                  {t.actions.cancel}
                </button>
              ) : null}
            </div>
          </form>
        )}
        {status ? <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>{status}</p> : null}
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <SectionTitle
            title={ti.products}
            subtitle={`${rows.length}${warehouseFilter ? ` • ${locations.find((l) => l.id === warehouseFilter)?.name ?? ""}` : ""}`}
          />
          <SuggestInput
            value={query}
            onChange={setQuery}
            loadSuggestions={loadInventorySuggestions}
            onPick={(item) => {
              onEdit(item.data as ProductRow);
            }}
            placeholder={ti.searchPlaceholder}
            className="ms-auto w-full max-w-sm"
            minChars={1}
          />
          <Button
            type="button"
            onClick={() => { void loadProducts(query); }}
            variant="secondary"
          >
            {t.actions.search}
          </Button>
        </div>
        {loading ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>{t.actions.loading}</p>
        ) : rows.length === 0 ? (
          <EmptyState title={ti.noProducts} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr className="border-b text-start" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                  <th className="px-2 py-2 font-medium text-start">{ti.colName}</th>
                  <th className="px-2 py-2 font-medium text-start">{ti.colSku}</th>
                  <th className="px-2 py-2 font-medium text-start">{ti.colCategory}</th>
                  <th className="px-2 py-2 font-medium text-start">{ti.colStock}</th>
                  <th className="px-2 py-2 font-medium text-start">{ti.colSpecs}</th>
                  <th className="px-2 py-2 font-medium text-start">{ti.colCost}</th>
                  <th className="px-2 py-2 font-medium text-start">{ti.colSell}</th>
                  <th className="px-2 py-2 font-medium text-start">{ti.colTax}</th>
                  <th className="px-2 py-2 font-medium text-start">{ti.colActions}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <Fragment key={row.id}>
                    <tr className="border-b" style={{ borderColor: "var(--border)" }}>
                      <td className="px-2 py-2">{row.name}</td>
                      <td className="px-2 py-2">{row.sku}</td>
                      <td className="px-2 py-2">{row.categoryName}</td>
                      <td className="px-2 py-2">
                        <p className="font-medium">{totalStockByProduct.get(row.id) ?? 0}</p>
                        <p className="text-xs" style={{ color: "var(--muted)" }}>{locationStockLabel(row.id)}</p>
                      </td>
                      <td className="px-2 py-2">
                        {row.componentCategory && row.specs && Object.keys(row.specs).length > 0 ? (
                          <ul className="space-y-0.5">
                            {Object.entries(row.specs)
                              .slice(0, 4)
                              .map(([key, value]) => (
                                <li key={key} className="text-xs" style={{ color: "var(--muted)" }}>
                                  {key}: {value}
                                </li>
                              ))}
                          </ul>
                        ) : (
                          <span className="text-xs" style={{ color: "var(--muted)" }}>-</span>
                        )}
                      </td>
                      <td className="px-2 py-2">{row.costPrice.toFixed(2)}</td>
                      <td className="px-2 py-2">{row.sellPrice.toFixed(2)}</td>
                      <td className="px-2 py-2">{row.taxRate}</td>
                      <td className="px-2 py-2">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => onEdit(row)}
                            className="rounded border px-2 py-1 text-sm"
                            style={{ borderColor: "var(--border)" }}
                          >
                            {ti.edit}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAdjustingProductId(row.id);
                              if (!adjustLocationId && locations.length > 0) {
                                setAdjustLocationId(locations[0].id);
                              }
                            }}
                            className="rounded border px-2 py-1 text-sm"
                            style={{ borderColor: "var(--border)" }}
                          >
                            {ti.adjustStock}
                          </button>
                          <button
                            type="button"
                            onClick={() => { void onDelete(row.id); }}
                            className="rounded border px-2 py-1 text-sm"
                            style={{ borderColor: "var(--border)" }}
                          >
                            {ti.archive}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {adjustingProductId === row.id ? (
                      <tr className="border-b" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
                        <td colSpan={9} className="px-2 py-3">
                          <div className="grid grid-cols-1 gap-2 md:grid-cols-[1.5fr_1fr_2fr_auto_auto]">
                            <select
                              value={adjustLocationId}
                              onChange={(e) => setAdjustLocationId(e.target.value)}
                              className="rounded border px-3 py-2 text-sm"
                              style={{ borderColor: "var(--border)" }}
                            >
                              {locations.map((location) => (
                                <option key={location.id} value={location.id}>
                                  {location.name}
                                </option>
                              ))}
                            </select>
                            <input
                              type="number"
                              step="1"
                              value={adjustDelta}
                              onChange={(e) => setAdjustDelta(e.target.value)}
                              className="rounded border px-3 py-2 text-sm"
                              style={{ borderColor: "var(--border)" }}
                              placeholder="+5 or -2"
                            />
                            <input
                              value={adjustReason}
                              onChange={(e) => setAdjustReason(e.target.value)}
                              className="rounded border px-3 py-2 text-sm"
                              style={{ borderColor: "var(--border)" }}
                              placeholder={ti.reasonOptional}
                            />
                            <button
                              type="button"
                              onClick={() => { void submitAdjustStock(); }}
                              disabled={adjusting}
                              className="rounded px-3 py-2 text-sm text-white disabled:opacity-60"
                              style={{ background: "var(--accent)" }}
                            >
                              {adjusting ? t.actions.saving : ti.apply}
                            </button>
                            <button
                              type="button"
                              onClick={() => setAdjustingProductId(null)}
                              className="rounded border px-3 py-2 text-sm"
                              style={{ borderColor: "var(--border)" }}
                            >
                              {t.actions.cancel}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </AppPage>
  );
}
