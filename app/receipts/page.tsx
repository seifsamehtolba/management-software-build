"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useReactToPrint } from "react-to-print";
import { AppPage, Button, Card, EmptyState, PageHeader, SectionTitle, Select, StatusBadge } from "@/components/ui/primitives";
import { SuggestInput, type SuggestItem } from "@/components/ui/SuggestInput";
import { errorMessageFromJson, parseResponseJson } from "@/lib/parseResponseJson";
import { hasPermission, PERMISSIONS, normalizePermissions } from "@/lib/permissions";
import { useLang } from "@/lib/i18n";

type BranchOption = {
  id: string;
  name: string;
};

type ReceiptLine = {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  refundedQty: number;
  unitPrice: number;
  total: number;
};

type ReceiptPayment = {
  id: string;
  method: string;
  amount: number;
  reference?: string | null;
};

type Receipt = {
  id: string;
  invoiceNumber: string;
  createdAt: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  total: number;
  customer: { id: string; name: string; phone: string } | null;
  cashier: { id: string; name: string; branch: { id: string; name: string } | null };
  items: ReceiptLine[];
  refunds: Array<{
    id: string;
    amount: number;
    settlementMethod: string | null;
    refundMode: string;
    replacementSaleId: string | null;
    exchangeReference: string | null;
    createdAt: string;
  }>;
  payments: ReceiptPayment[];
};

type LocationOption = {
  id: string;
  name: string;
  branchId: string | null;
};

type RefundDraftItem = {
  quantity: string;
  restock: boolean;
};

export default function ReceiptsPage() {
  const { t, lang } = useLang();
  const tr = t.receipts;
  const { data: session } = useSession();
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [branchId, setBranchId] = useState("");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState(() => query);
  const queryDebounceSkip = useRef(false);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [selectedReceiptId, setSelectedReceiptId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [refundDraft, setRefundDraft] = useState<Record<string, RefundDraftItem>>({});
  const [refundReason, setRefundReason] = useState("");
  const [refundSettlementMethod, setRefundSettlementMethod] = useState("CASH");
  const [refundMode, setRefundMode] = useState<"STANDARD" | "EXCHANGE">("STANDARD");
  const [refundLocationId, setRefundLocationId] = useState("");
  const [replacementInvoiceNumber, setReplacementInvoiceNumber] = useState("");
  const [refunding, setRefunding] = useState(false);
  const [refundStatus, setRefundStatus] = useState("");

  const fmt = (n: number) =>
    new Intl.NumberFormat(lang === "ar" ? "ar-EG" : "en-EG", { style: "currency", currency: "EGP" }).format(n);

  const selected = useMemo(
    () => receipts.find((receipt) => receipt.id === selectedReceiptId) ?? receipts[0] ?? null,
    [receipts, selectedReceiptId],
  );

  useEffect(() => {
    const timer = setTimeout(async () => {
      const [branchResponse, locationResponse] = await Promise.all([fetch("/api/branches"), fetch("/api/locations")]);
      if (branchResponse.ok) {
        const data = await parseResponseJson<BranchOption[]>(branchResponse);
        setBranches(Array.isArray(data) ? data : []);
      }
      if (locationResponse.ok) {
        const data = await parseResponseJson<LocationOption[]>(locationResponse);
        const rows = Array.isArray(data) ? data : [];
        setLocations(rows);
        if (!refundLocationId && rows.length > 0) {
          setRefundLocationId(rows[0].id);
        }
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [refundLocationId]);

  useEffect(() => {
    if (!queryDebounceSkip.current) {
      queryDebounceSkip.current = true;
      return;
    }
    const timer = setTimeout(() => setDebouncedQuery(query), 350);
    return () => clearTimeout(timer);
  }, [query]);

  const loadReceipts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (debouncedQuery.trim()) params.set("q", debouncedQuery.trim());
      if (branchId) params.set("branchId", branchId);
      const response = await fetch(`/api/receipts?${params.toString()}`);
      const payload = await parseResponseJson<{ receipts?: Receipt[] }>(response);
      const list = payload?.receipts ?? [];
      setReceipts(list);
      setSelectedReceiptId((current) => current || list[0]?.id || "");
    } finally {
      setLoading(false);
    }
  }, [branchId, debouncedQuery]);

  useEffect(() => {
    void loadReceipts();
  }, [loadReceipts]);

  const loadReceiptSuggestions = useCallback(
    async (q: string, signal: AbortSignal): Promise<SuggestItem[]> => {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (branchId) params.set("branchId", branchId);
      const response = await fetch(`/api/receipts?${params.toString()}`, { signal });
      if (!response.ok) return [];
      const payload = await parseResponseJson<{ receipts?: Receipt[] }>(response);
      const list = payload?.receipts ?? [];
      return list.slice(0, 12).map((r) => ({
        id: r.id,
        label: r.invoiceNumber,
        description: [
          r.customer?.name ?? tr.walkIn,
          new Date(r.createdAt).toLocaleString(lang === "ar" ? "ar-EG" : "en-EG"),
        ].join(" · "),
        data: r,
      }));
    },
    [branchId, lang, tr.walkIn],
  );

  const receiptRef = useRef<HTMLDivElement>(null);
  const printReceipt = useReactToPrint({
    contentRef: receiptRef,
    documentTitle: selected?.invoiceNumber ?? "receipt",
  });

  const canCrossBranch = hasPermission(
    normalizePermissions(session?.user?.permissions ?? []),
    PERMISSIONS.salesReceiptsCrossBranch,
  );
  const canManageRefunds = hasPermission(
    normalizePermissions(session?.user?.permissions ?? []),
    PERMISSIONS.salesRefundsManage,
  );

  useEffect(() => {
    if (!selected) return;
    setRefundDraft(
      Object.fromEntries(
        selected.items.map((item) => [
          item.id,
          {
            quantity: "",
            restock: true,
          } satisfies RefundDraftItem,
        ]),
      ),
    );
    setRefundReason("");
    setRefundStatus("");
    setReplacementInvoiceNumber("");
    setRefundMode("STANDARD");
    setRefundSettlementMethod("CASH");
  }, [selected?.id]);

  const updateRefundItem = (saleItemId: string, patch: Partial<RefundDraftItem>) => {
    setRefundDraft((current) => ({
      ...current,
      [saleItemId]: {
        quantity: current[saleItemId]?.quantity ?? "",
        restock: current[saleItemId]?.restock ?? true,
        ...patch,
      },
    }));
  };

  const submitRefund = async () => {
    if (!selected || !canManageRefunds) return;
    const items = selected.items
      .map((item) => ({
        saleItemId: item.id,
        quantity: Number(refundDraft[item.id]?.quantity ?? 0),
        restock: refundDraft[item.id]?.restock ?? true,
        locationId: refundDraft[item.id]?.restock ? refundLocationId || undefined : undefined,
      }))
      .filter((item) => Number.isInteger(item.quantity) && item.quantity > 0);
    if (!refundReason.trim() || items.length === 0) {
      setRefundStatus("Enter a reason and at least one item quantity.");
      return;
    }
    setRefunding(true);
    try {
      const response = await fetch(`/api/receipts/${selected.id}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: refundReason,
          settlementMethod: refundSettlementMethod,
          refundMode,
          replacementInvoiceNumber: replacementInvoiceNumber || undefined,
          items,
        }),
      });
      const payload = await parseResponseJson<{ message?: string }>(response);
      if (!response.ok) {
        setRefundStatus(errorMessageFromJson(payload, "Could not process refund."));
        return;
      }
      setRefundStatus(refundMode === "EXCHANGE" ? "Exchange saved." : "Refund saved.");
      await loadReceipts();
    } finally {
      setRefunding(false);
    }
  };

  return (
    <AppPage>
      <PageHeader title={tr.title} subtitle={tr.subtitle} />
      <Card className="mb-4">
        <SectionTitle title={tr.filters} />
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[2fr_1fr_auto_auto]">
          <SuggestInput
            value={query}
            onChange={setQuery}
            loadSuggestions={loadReceiptSuggestions}
            onPick={(item) => setSelectedReceiptId(item.id)}
            placeholder={tr.searchPlaceholder}
            minChars={1}
          />
          <Select
            value={branchId}
            onChange={(event) => setBranchId(event.target.value)}
            disabled={!canCrossBranch}
          >
            <option value="">{tr.allBranches}</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
          <Button
            type="button"
            onClick={() => { void loadReceipts(); }}
            variant="secondary"
          >
            {tr.refresh}
          </Button>
          <Button
            type="button"
            onClick={printReceipt}
            disabled={!selected}
          >
            {tr.printSelected}
          </Button>
        </div>
      </Card>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle title={tr.receiptList} />
          {loading ? <p className="text-sm" style={{ color: "var(--muted)" }}>{tr.loading}</p> : null}
          {!loading && receipts.length === 0 ? <EmptyState title={tr.noReceipts} /> : null}
          <ul className="space-y-2">
            {receipts.map((receipt) => (
              <li key={receipt.id}>
                <button
                  type="button"
                  onClick={() => setSelectedReceiptId(receipt.id)}
                  className="w-full rounded border p-3 text-start text-sm"
                  style={{
                    borderColor: selected?.id === receipt.id ? "var(--accent)" : "var(--border)",
                    background: selected?.id === receipt.id ? "var(--surface)" : undefined,
                  }}
                >
                  <p className="font-medium">{receipt.invoiceNumber}</p>
                  <p style={{ color: "var(--muted)" }}>
                    {new Date(receipt.createdAt).toLocaleString(lang === "ar" ? "ar-EG" : "en-EG")} · {tr.branch}: {receipt.cashier.branch?.name ?? "N/A"}
                  </p>
                  <p className="mt-1">
                    <StatusBadge tone="neutral">{tr.total}: {fmt(receipt.total)}</StatusBadge>
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <SectionTitle title={tr.receiptDetails} />
          {!selected ? (
            <p className="text-sm" style={{ color: "var(--muted)" }}>{tr.selectReceipt}</p>
          ) : (
            <div className="space-y-3 text-sm">
              <p className="font-medium">{selected.invoiceNumber}</p>
              <p>{tr.date}: {new Date(selected.createdAt).toLocaleString(lang === "ar" ? "ar-EG" : "en-EG")}</p>
              <p>{tr.branch}: {selected.cashier.branch?.name ?? "N/A"}</p>
              <p>{tr.customer}: {selected.customer?.name ?? tr.walkIn}</p>
              <div>
                <p className="mb-1 font-medium">{tr.items}</p>
                <ul className="space-y-1">
                  {selected.items.map((item) => (
                    <li key={item.id} className="flex items-center justify-between">
                      <span>
                        {item.productName} x {item.quantity}
                        {item.refundedQty > 0 ? (
                          <span className="ms-2 text-xs" style={{ color: "var(--muted)" }}>
                            Refunded: {item.refundedQty}
                          </span>
                        ) : null}
                      </span>
                      <span>{fmt(item.total)}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-1 font-medium">{tr.payments}</p>
                <ul className="space-y-1">
                  {selected.payments.map((payment) => (
                    <li key={payment.id} className="flex items-center justify-between">
                      <span>{payment.method}</span>
                      <span>{fmt(payment.amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="border-t pt-2 font-semibold" style={{ borderColor: "var(--border)" }}>
                {tr.total}: {fmt(selected.total)}
              </p>
              <div className="border-t pt-3" style={{ borderColor: "var(--border)" }}>
                <p className="mb-2 font-medium">Returns & exchanges</p>
                {selected.refunds.length === 0 ? (
                  <p className="text-sm" style={{ color: "var(--muted)" }}>No refunds recorded yet.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {selected.refunds.map((refund) => (
                      <li key={refund.id} className="rounded border p-2" style={{ borderColor: "var(--border)" }}>
                        <p className="font-medium">
                          {refund.refundMode === "EXCHANGE" ? "Exchange" : "Refund"} · {fmt(refund.amount)}
                        </p>
                        <p style={{ color: "var(--muted)" }}>
                          {refund.settlementMethod ?? "Unspecified"} · {new Date(refund.createdAt).toLocaleString(lang === "ar" ? "ar-EG" : "en-EG")}
                        </p>
                        {refund.exchangeReference ? (
                          <p className="text-xs" style={{ color: "var(--muted)" }}>
                            Ref: {refund.exchangeReference}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {canManageRefunds ? (
                <div className="space-y-3 rounded border p-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
                  <p className="font-medium">Process refund / exchange</p>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    <Select value={refundMode} onChange={(event) => setRefundMode(event.target.value as "STANDARD" | "EXCHANGE")}>
                      <option value="STANDARD">Refund</option>
                      <option value="EXCHANGE">Exchange</option>
                    </Select>
                    <Select value={refundSettlementMethod} onChange={(event) => setRefundSettlementMethod(event.target.value)}>
                      <option value="CASH">Cash</option>
                      <option value="CARD">Card</option>
                      <option value="STORE_CREDIT">Store credit</option>
                      <option value="BANK_TRANSFER">Bank transfer</option>
                    </Select>
                  </div>
                  <input
                    value={refundReason}
                    onChange={(event) => setRefundReason(event.target.value)}
                    className="w-full rounded border px-3 py-2 text-sm"
                    style={{ borderColor: "var(--border)" }}
                    placeholder="Reason"
                  />
                  {refundMode === "EXCHANGE" ? (
                    <input
                      value={replacementInvoiceNumber}
                      onChange={(event) => setReplacementInvoiceNumber(event.target.value)}
                      className="w-full rounded border px-3 py-2 text-sm"
                      style={{ borderColor: "var(--border)" }}
                      placeholder="Replacement invoice number (optional if using store credit)"
                    />
                  ) : null}
                  <div>
                    <p className="mb-2 text-sm font-medium">Select item quantities</p>
                    <div className="space-y-2">
                      {selected.items.map((item) => {
                        const remainingQty = item.quantity - item.refundedQty;
                        return (
                          <div key={item.id} className="grid grid-cols-1 gap-2 rounded border p-2 md:grid-cols-[2fr_1fr_1fr]" style={{ borderColor: "var(--border)" }}>
                            <div>
                              <p className="font-medium">{item.productName}</p>
                              <p className="text-xs" style={{ color: "var(--muted)" }}>
                                Sold {item.quantity} · Remaining refundable {remainingQty}
                              </p>
                            </div>
                            <input
                              type="number"
                              min="0"
                              max={remainingQty}
                              step="1"
                              value={refundDraft[item.id]?.quantity ?? ""}
                              onChange={(event) => updateRefundItem(item.id, { quantity: event.target.value })}
                              className="rounded border px-3 py-2 text-sm"
                              style={{ borderColor: "var(--border)" }}
                            />
                            <label className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={refundDraft[item.id]?.restock ?? true}
                                onChange={(event) => updateRefundItem(item.id, { restock: event.target.checked })}
                              />
                              Restock
                            </label>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <Select value={refundLocationId} onChange={(event) => setRefundLocationId(event.target.value)}>
                    <option value="">Select restock location</option>
                    {locations
                      .filter((location) => !selected.cashier.branch?.id || !location.branchId || location.branchId === selected.cashier.branch.id)
                      .map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.name}
                        </option>
                      ))}
                  </Select>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" onClick={() => void submitRefund()} disabled={refunding}>
                      {refunding ? "Saving..." : refundMode === "EXCHANGE" ? "Save exchange" : "Save refund"}
                    </Button>
                    {refundStatus ? (
                      <p className="text-sm" style={{ color: "var(--muted)" }}>{refundStatus}</p>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </Card>
      </section>

      <div className="hidden">
        <div ref={receiptRef} className="max-w-sm p-4 text-black">
          {selected ? (
            <>
              <h3 className="text-lg font-bold">{selected.cashier.branch?.name ?? "Store Branch"}</h3>
              <p className="text-sm">{selected.invoiceNumber}</p>
              <p className="text-sm">{new Date(selected.createdAt).toLocaleString(lang === "ar" ? "ar-EG" : "en-EG")}</p>
              <p className="text-sm">{selected.cashier.name}</p>
              <p className="mb-2 text-sm">{selected.customer?.name ?? tr.walkIn}</p>
              <ul className="space-y-1 text-sm">
                {selected.items.map((item) => (
                  <li key={item.id} className="flex justify-between">
                    <span>
                      {item.productName} x {item.quantity}
                    </span>
                    <span>{fmt(item.total)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 border-t pt-2 text-sm font-semibold">{tr.total}: {fmt(selected.total)}</p>
            </>
          ) : null}
        </div>
      </div>
    </AppPage>
  );
}
