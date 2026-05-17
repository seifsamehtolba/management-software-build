"use client";

import Link from "next/link";
import Image from "next/image";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useReactToPrint } from "react-to-print";
import { AtSign, Globe, Minus, Phone, Plus, ReceiptText, Trash2, User } from "lucide-react";
import { db, type LocalCashShift, type LocalCustomer, type LocalProduct, type LocalSale } from "@/lib/localDb";
import { findProduct } from "@/lib/productSearch";
import {
  type HeldTransaction,
  type LastSaleCustomerSnapshot,
  type LastSaleReceipt,
  type PaymentSplit,
  usePosStore,
} from "@/lib/posStore";
import { writeLocal } from "@/lib/writeLocal";
import { syncEngine } from "@/lib/syncEngine";
import { errorMessageFromJson, parseResponseJson } from "@/lib/parseResponseJson";
import { AppPage, Button, Card, Input, PageHeader, SectionTitle } from "@/components/ui/primitives";
import { hasPermission, PERMISSIONS, normalizePermissions } from "@/lib/permissions";
import { useLang } from "@/lib/i18n";
import { PosSoftKeyboard, type PosOskTarget } from "@/components/pos/PosSoftKeyboard";
import { SuggestInput, type SuggestItem } from "@/components/ui/SuggestInput";

const HELD_TRANSACTIONS_KEY = "pos-held-transactions";
const POS_OSK_LS = "pos-osk-enabled";
const POS_KIOSK_LS = "pos-kiosk-mode";

function storeCreditFromPayments(payments: PaymentSplit[]): number {
  return payments.filter((p) => p.method === "STORE_CREDIT").reduce((sum, p) => sum + p.amount, 0);
}

function formatCustomerTypeLabel(type: string): string {
  return type
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

async function buildReceiptFromLocalSale(saleId: string): Promise<LastSaleReceipt | null> {
  const sale = await db.sales.get(saleId);
  if (!sale) return null;
  const [items, pays] = await Promise.all([
    db.sale_items.where("saleId").equals(saleId).toArray(),
    db.payments.where("saleId").equals(saleId).toArray(),
  ]);
  let customer: LastSaleCustomerSnapshot | null = null;
  if (sale.customerId) {
    const c = await db.customers.get(sale.customerId);
    if (c) {
      customer = {
        id: c.id,
        name: c.name,
        phone: c.phone,
        type: c.type,
        ...(c.email ? { email: c.email } : {}),
      };
    }
  }
  return {
    invoiceNumber: sale.invoiceNumber,
    createdAt: sale.createdAt,
    payments: pays.map((p) => ({
      method: p.method,
      amount: p.amount,
      reference: p.reference,
    })),
    lines: items.map((i) => ({
      id: i.productId,
      name: i.productName,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
    })),
    total: sale.total,
    customer,
    loyaltyDiscount: sale.discountAmount,
    notes: sale.notes?.trim() || undefined,
    sourceSaleId: sale.id,
  };
}

type CreateCustomerPayload = {
  name: string;
  phone: string;
  email: string;
  address: string;
  type: "REGULAR" | "VIP" | "WHOLESALE";
};

function appendDecimalKey(buffer: string, key: string): string {
  if (key === ".") {
    if (buffer.includes(".")) return buffer;
    return buffer === "" ? "0." : buffer + ".";
  }
  if (/^\d$/.test(key)) return buffer + key;
  return buffer;
}

function customerRowToLocal(row: Record<string, unknown>): LocalCustomer | null {
  const id = row.id;
  if (typeof id !== "string" || !id) return null;
  return {
    id,
    name: String(row.name ?? ""),
    phone: String(row.phone ?? ""),
    email: row.email != null ? String(row.email) : undefined,
    creditBalance: Number(row.creditBalance ?? 0),
    loyaltyPoints: Number(row.loyaltyPoints ?? 0),
    type: String(row.type ?? "REGULAR"),
    syncStatus: "synced",
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : new Date().toISOString(),
  };
}

function prefillNewCustomerFromQuery(q: string): Pick<CreateCustomerPayload, "name" | "phone"> {
  const trimmed = q.trim();
  const digits = trimmed.replace(/\D/g, "");
  const looksLikePhone = digits.length >= 8 && /^[\d\s\-+().]*$/.test(trimmed);
  if (looksLikePhone) {
    return { name: "", phone: digits };
  }
  return { name: trimmed, phone: "" };
}

type ApiProductListRow = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  categoryId: string;
  categoryName: string;
  brandName: string | null;
  sellPrice: number;
  costPrice: number;
  taxRate: number;
  hasSerials: boolean;
  updatedAt: string;
};

function apiListRowToLocal(p: ApiProductListRow): LocalProduct {
  return {
    id: p.id,
    sku: p.sku,
    barcode: p.barcode ?? undefined,
    name: p.name,
    categoryId: p.categoryId,
    categoryName: p.categoryName,
    brandName: p.brandName ?? undefined,
    sellPrice: p.sellPrice,
    costPrice: p.costPrice,
    taxRate: p.taxRate,
    hasSerials: p.hasSerials,
    salesRank: 0,
    syncStatus: "synced",
    updatedAt: p.updatedAt,
  };
}

export default function PosPage() {
  const { t, lang } = useLang();
  const tp = t.pos;
  const { data: session } = useSession();
  const {
    query,
    status,
    found,
    cart,
    paymentSplits,
    customerQuery,
    customerResults,
    selectedCustomer,
    redeemPoints,
    heldTransactions,
    saving,
    lastSale,
    setQuery,
    setStatus,
    setFound,
    setCustomerQuery,
    setCustomerResults,
    setSelectedCustomer,
    setRedeemPoints,
    setHeldTransactions,
    setSaving,
    setLastSale,
    addToCart,
    addManualItem,
    updatePayment,
    addPaymentSplit,
    removePaymentSplit,
    autoBalancePayments,
    holdCurrentTransaction,
    resumeHeldTransaction,
    discardHeldTransaction,
    resetAfterCheckout,
    adjustCartLineQuantity,
    removeCartLine,
  } = usePosStore();
  const [online, setOnline] = useState(
    typeof window === "undefined" ? true : window.navigator.onLine,
  );
  const [storeName, setStoreName] = useState("Store");
  const [storeLogoUrl, setStoreLogoUrl] = useState("");
  const [storePhone, setStorePhone] = useState("");
  const [storeWebsite, setStoreWebsite] = useState("");
  const [storeInstagram, setStoreInstagram] = useState("");
  const [loyaltySettings, setLoyaltySettings] = useState({
    enabled: true,
    pointsPerEgp: 0.01,
    redemptionValuePerPoint: 1,
  });
  const [printMode, setPrintMode] = useState<"receipt" | "a4">("receipt");
  const [createCustomerOpen, setCreateCustomerOpen] = useState(false);
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [newCustomer, setNewCustomer] = useState<CreateCustomerPayload>({
    name: "",
    phone: "",
    email: "",
    address: "",
    type: "REGULAR",
  });
  const [manualOpen, setManualOpen] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualPrice, setManualPrice] = useState("");
  const [keyboardEnabled, setKeyboardEnabled] = useState(false);
  const [kioskMode, setKioskMode] = useState(false);
  const [paymentAmountOsk, setPaymentAmountOsk] = useState("");
  const [oskTarget, setOskTarget] = useState<PosOskTarget | null>(null);
  const [historyReceipt, setHistoryReceipt] = useState<LastSaleReceipt | null>(null);
  const [historySaleId, setHistorySaleId] = useState<string | null>(null);
  const [recentSales, setRecentSales] = useState<LocalSale[]>([]);
  const [recentSalesLoading, setRecentSalesLoading] = useState(false);
  const [notesModalSale, setNotesModalSale] = useState<LocalSale | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [notesSaving, setNotesSaving] = useState(false);
  const [activeShift, setActiveShift] = useState<LocalCashShift | null>(null);
  const [shiftOpeningCash, setShiftOpeningCash] = useState("0");
  const [shiftCountedCash, setShiftCountedCash] = useState("");
  const [shiftNote, setShiftNote] = useState("");

  const isAdmin = hasPermission(
    normalizePermissions(session?.user?.permissions ?? []),
    PERMISSIONS.salesNotesUpdate,
  );
  const receiptToPrint = historyReceipt ?? lastSale;

  const loadRecentSales = useCallback(async () => {
    setRecentSalesLoading(true);
    try {
      const rows = await db.sales.orderBy("createdAt").reverse().limit(80).toArray();
      setRecentSales(rows);
    } finally {
      setRecentSalesLoading(false);
    }
  }, []);

  const loadActiveShift = useCallback(async () => {
    const userId = session?.user?.id;
    if (!userId) return;
    const rows = await db.cash_shifts
      .filter((shift) => shift.userId === userId && shift.status === "OPEN")
      .toArray();
    const shift = rows.sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime())[0] ?? null;
    setActiveShift(shift);
    setShiftCountedCash(shift ? shift.expectedCash.toFixed(2) : "");
  }, [session?.user?.id]);

  useEffect(() => {
    void loadRecentSales();
  }, [loadRecentSales]);

  useEffect(() => {
    void loadActiveShift();
  }, [loadActiveShift]);

  const openCashShift = useCallback(async () => {
    const userId = session?.user?.id;
    const branchId = session?.user?.branchId;
    const openingCash = Number(shiftOpeningCash);
    if (!userId || !branchId || !Number.isFinite(openingCash) || openingCash < 0) {
      setStatus("Enter a valid opening cash amount.");
      return;
    }
    if (activeShift) {
      setStatus("Close the current shift before opening a new one.");
      return;
    }

    try {
      const openedAt = new Date().toISOString();
      const shift = await writeLocal("cash_shifts", {
        branchId,
        userId,
        status: "OPEN",
        openedAt,
        openingCash,
        expectedCash: openingCash,
        variance: 0,
        notes: shiftNote.trim() || undefined,
      });
      await writeLocal("cash_shift_entries", {
        shiftId: shift.id,
        branchId,
        userId,
        type: "OPENING_FLOAT",
        amount: openingCash,
        note: shiftNote.trim() || "Shift opened",
        createdAt: openedAt,
      });
      setStatus("Cash shift opened.");
      setShiftNote("");
      setShiftCountedCash(openingCash.toFixed(2));
      await loadActiveShift();
      if (online) {
        await syncEngine.flushQueue();
      }
    } catch {
      setStatus("Could not open cash shift.");
    }
  }, [activeShift, loadActiveShift, online, session?.user?.branchId, session?.user?.id, shiftNote, shiftOpeningCash, setStatus]);

  const closeCashShift = useCallback(async () => {
    const userId = session?.user?.id;
    if (!activeShift || !userId) {
      setStatus("No open shift to close.");
      return;
    }
    const countedCash = Number(shiftCountedCash);
    if (!Number.isFinite(countedCash) || countedCash < 0) {
      setStatus("Enter a valid counted cash amount.");
      return;
    }

    try {
      const closedAt = new Date().toISOString();
      const variance = Number((countedCash - activeShift.expectedCash).toFixed(2));
      await writeLocal("cash_shift_entries", {
        shiftId: activeShift.id,
        branchId: activeShift.branchId,
        userId,
        type: "CLOSE",
        amount: countedCash,
        note: shiftNote.trim() || "Shift closed",
        createdAt: closedAt,
      });
      await writeLocal(
        "cash_shifts",
        {
          ...activeShift,
          status: "CLOSED",
          closedAt,
          countedCash,
          variance,
          notes: shiftNote.trim() || activeShift.notes,
        },
        "UPDATE",
      );
      setStatus(`Shift closed. Variance: EGP ${variance.toFixed(2)}.`);
      setShiftNote("");
      setShiftCountedCash("");
      setActiveShift(null);
      if (online) {
        await syncEngine.flushQueue();
      }
    } catch {
      setStatus("Could not close cash shift.");
    }
  }, [activeShift, online, session?.user?.id, shiftCountedCash, shiftNote, setStatus]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(HELD_TRANSACTIONS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as HeldTransaction[];
      setTimeout(() => {
        setHeldTransactions(Array.isArray(parsed) ? parsed : []);
      }, 0);
    } catch {
      setTimeout(() => {
        setHeldTransactions([]);
      }, 0);
    }
  }, [setHeldTransactions]);

  const receiptRef = useRef<HTMLDivElement>(null);
  const printReceipt = useReactToPrint({
    contentRef: receiptRef,
    documentTitle: receiptToPrint?.invoiceNumber ?? "receipt",
    pageStyle:
      printMode === "a4"
        ? `
      @page { size: A4 portrait; margin: 0; }
      @media print {
        html, body {
          margin: 0;
          padding: 0;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .a4-invoice-items {
          overflow: hidden !important;
        }
      }
    `
        : `
      @page { size: auto; margin: 4mm; }
      @media print {
        html, body {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
      }
    `,
  });

  const printHistoricalInvoice = useCallback(
    async (saleId: string) => {
      const built = await buildReceiptFromLocalSale(saleId);
      if (!built) {
        setStatus("Could not load that transaction.");
        return;
      }
      setHistoryReceipt(built);
      setHistorySaleId(saleId);
      setTimeout(() => {
        void printReceipt();
      }, 150);
    },
    [printReceipt, setStatus],
  );

  const saveInvoiceNotes = useCallback(async () => {
    if (!notesModalSale || !isAdmin) return;
    setNotesSaving(true);
    try {
      const nextNotes = notesDraft.trim();
      const fresh = await db.sales.get(notesModalSale.id);
      if (!fresh) {
        setStatus("Sale no longer exists locally.");
        setNotesModalSale(null);
        return;
      }
      await writeLocal("sales", { ...fresh, notes: nextNotes || undefined }, "UPDATE");
      await loadRecentSales();
      if (historySaleId === notesModalSale.id) {
        setHistoryReceipt((prev) => (prev ? { ...prev, notes: nextNotes || undefined } : null));
      }
      setNotesModalSale(null);
      setStatus("Invoice notes saved.");
      try {
        await syncEngine.flushQueue();
      } catch {
        // Queue flush is best-effort when offline.
      }
    } catch {
      setStatus("Could not save notes.");
    } finally {
      setNotesSaving(false);
    }
  }, [notesModalSale, isAdmin, notesDraft, loadRecentSales, historySaleId, setStatus]);

  useEffect(() => {
    const timer = setTimeout(async () => {
      const res = await fetch("/api/settings/store", { cache: "no-store" });
      if (!res.ok) return;
      const settings = await parseResponseJson<{
        storeName?: string;
        storeLogoUrl?: string;
        storePhone?: string;
        storeWebsite?: string;
        storeInstagram?: string;
        loyaltySettings?: {
          enabled: boolean;
          pointsPerEgp: number;
          redemptionValuePerPoint: number;
        };
      }>(res);
      if (!settings) return;
      setStoreName(settings.storeName || "Store");
      setStoreLogoUrl(settings.storeLogoUrl || "");
      setStorePhone(settings.storePhone || "");
      setStoreWebsite(settings.storeWebsite || "");
      setStoreInstagram(settings.storeInstagram || "");
      if (settings.loyaltySettings) {
        setLoyaltySettings(settings.loyaltySettings);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(HELD_TRANSACTIONS_KEY, JSON.stringify(heldTransactions));
  }, [heldTransactions]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setKeyboardEnabled(localStorage.getItem(POS_OSK_LS) === "1");
    setKioskMode(localStorage.getItem(POS_KIOSK_LS) === "1");
  }, []);

  useEffect(() => {
    localStorage.setItem(POS_OSK_LS, keyboardEnabled ? "1" : "0");
  }, [keyboardEnabled]);

  useEffect(() => {
    localStorage.setItem(POS_KIOSK_LS, kioskMode ? "1" : "0");
  }, [kioskMode]);

  useEffect(() => {
    if (!keyboardEnabled) {
      setOskTarget(null);
    }
  }, [keyboardEnabled]);

  const selectOskTarget = useCallback((t: PosOskTarget | null) => {
    setOskTarget(t);
  }, []);

  const selectPaymentAmountOsk = useCallback(
    (index: number) => {
      const a = paymentSplits[index]?.amount;
      setPaymentAmountOsk(Number.isFinite(a) ? String(a) : "");
      setOskTarget({ kind: "paymentAmount", index });
    },
    [paymentSplits],
  );

  const applyOskKey = useCallback((action: string) => {
    if (!oskTarget) return;
    const chop = (s: string) => (s.length <= 1 ? "" : s.slice(0, -1));

    if (oskTarget.kind === "manualPrice") {
      if (action === "bksp") {
        setManualPrice((prev) => chop(prev));
        return;
      }
      if (action === " ") return;
      if (!/^[0-9.]$/.test(action)) return;
      setManualPrice((prev) => appendDecimalKey(prev, action));
      return;
    }

    if (oskTarget.kind === "redeem") {
      if (action === "bksp") {
        const prev = usePosStore.getState().redeemPoints;
        const s = String(Math.max(0, Math.floor(prev)));
        const next = chop(s);
        const n = next === "" ? 0 : parseInt(next, 10) || 0;
        setRedeemPoints(n);
        return;
      }
      if (!/^\d$/.test(action)) return;
      const prev = usePosStore.getState().redeemPoints;
      const base = String(Math.max(0, Math.floor(prev)));
      const raw = base + action;
      const n = parseInt(raw.replace(/\D/g, "") || "0", 10);
      setRedeemPoints(Number.isNaN(n) ? 0 : n);
      return;
    }

    if (oskTarget.kind === "paymentAmount") {
      const i = oskTarget.index;
      if (action === "bksp") {
        setPaymentAmountOsk((prev) => {
          const next = chop(prev);
          const trimmed = next.trim();
          const st = usePosStore.getState();
          if (trimmed === "" || trimmed === ".") {
            st.updatePayment(i, { amount: 0 });
          } else {
            const n = parseFloat(trimmed);
            if (!Number.isNaN(n)) st.updatePayment(i, { amount: n });
          }
          return next;
        });
        return;
      }
      if (!/^[0-9.]$/.test(action)) return;
      setPaymentAmountOsk((prev) => {
        const next = appendDecimalKey(prev, action);
        const trimmed = next.trim();
        const st = usePosStore.getState();
        if (trimmed === "" || trimmed === ".") {
          st.updatePayment(i, { amount: 0 });
        } else {
          const n = parseFloat(trimmed);
          if (!Number.isNaN(n)) st.updatePayment(i, { amount: n });
        }
        return next;
      });
      return;
    }

    const store = usePosStore.getState();

    if (action === "bksp") {
      switch (oskTarget.kind) {
        case "query":
          store.setQuery(chop(store.query));
          return;
        case "customerQuery":
          store.setCustomerQuery(chop(store.customerQuery));
          return;
        case "manualName":
          setManualName((prev) => chop(prev));
          return;
        case "paymentRef": {
          const idx = oskTarget.index;
          const cur = store.paymentSplits[idx]?.reference ?? "";
          store.updatePayment(idx, { reference: chop(cur) });
          return;
        }
        case "newCustomer":
          setNewCustomer((prev) => ({
            ...prev,
            [oskTarget.field]: chop(String(prev[oskTarget.field] ?? "")),
          }));
          return;
      }
    }

    const ch = action;
    switch (oskTarget.kind) {
      case "query":
        store.setQuery(store.query + ch);
        return;
      case "customerQuery":
        store.setCustomerQuery(store.customerQuery + ch);
        return;
      case "manualName":
        setManualName((prev) => prev + ch);
        return;
      case "paymentRef": {
        const idx = oskTarget.index;
        const cur = store.paymentSplits[idx]?.reference ?? "";
        store.updatePayment(idx, { reference: cur + ch });
        return;
      }
      case "newCustomer":
        setNewCustomer((prev) => ({
          ...prev,
          [oskTarget.field]: String(prev[oskTarget.field] ?? "") + ch,
        }));
        return;
    }
  }, [oskTarget]);

  const pageShellClass = useMemo(
    () =>
      [
        "pos-touch",
        keyboardEnabled ? "pos-touch-keys" : "",
        keyboardEnabled ? "pos-touch-osk" : "",
        kioskMode ? "pos-touch-kiosk" : "",
      ]
        .filter(Boolean)
        .join(" "),
    [keyboardEnabled, kioskMode],
  );

  const total = useMemo(
    () => cart.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0),
    [cart],
  );
  const paymentTotal = useMemo(
    () => paymentSplits.reduce((sum, payment) => sum + (Number.isFinite(payment.amount) ? payment.amount : 0), 0),
    [paymentSplits],
  );
  const pointsDiscount = useMemo(() => {
    if (!selectedCustomer || !loyaltySettings.enabled) return 0;
    const cappedRequested = Math.max(0, Math.floor(redeemPoints));
    const maxAllowedByBalance = Math.min(cappedRequested, selectedCustomer.loyaltyPoints);
    return Math.min(maxAllowedByBalance * loyaltySettings.redemptionValuePerPoint, total);
  }, [loyaltySettings.enabled, loyaltySettings.redemptionValuePerPoint, redeemPoints, selectedCustomer, total]);
  const finalTotal = useMemo(() => Math.max(total - pointsDiscount, 0), [total, pointsDiscount]);
  const remainingAmount = useMemo(() => Number((finalTotal - paymentTotal).toFixed(2)), [finalTotal, paymentTotal]);

  const onSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!query.trim()) return;

    setStatus("Searching...");
    const product = await findProduct(query);
    setFound(product);

    if (!product) {
      setStatus(online ? "Product not found." : "Product not in local cache. You can add a manual line item as fallback.");
      return;
    }

    setStatus("Product found.");
  };

  const submitManualItem = () => {
    const parsed = Number(manualPrice);
    const name = manualName.trim() || "Manual item";
    if (Number.isNaN(parsed) || parsed < 0) {
      setStatus("Enter a valid price for the manual line.");
      return;
    }
    addManualItem(name, parsed);
    setManualOpen(false);
    setManualName("");
    setManualPrice("");
    setStatus("Manual line added to cart.");
  };

  const attachCustomer = useCallback(
    async (customer: LocalCustomer) => {
      await db.customers.put(customer);
      setSelectedCustomer(customer);
      setCustomerResults([]);
      setCustomerQuery(customer.name);
      setCreateCustomerOpen(false);
      setRedeemPoints(0);
      setStatus(`${customer.name} — attached to this sale.`);
    },
    [setSelectedCustomer, setCustomerQuery, setRedeemPoints],
  );

  const searchCustomers = async () => {
    const rawQuery = customerQuery.trim();
    const normalized = rawQuery.toLowerCase();
    if (!normalized) {
      setCustomerResults([]);
      return;
    }

    const matches = await db.customers
      .filter(
        (customer) =>
          customer.name.toLowerCase().includes(normalized) || customer.phone.toLowerCase().includes(normalized),
      )
      .limit(8)
      .toArray();

    if (matches.length === 1) {
      await attachCustomer(matches[0]);
      return;
    }

    if (matches.length > 1 || !online) {
      setCustomerResults(matches);
      if (matches.length === 0 && !online) {
        setStatus("No customer in local cache. Connect to the internet to search the full directory.");
      }
      return;
    }

    const res = await fetch(`/api/customers?q=${encodeURIComponent(rawQuery)}`, { cache: "no-store" });
    if (!res.ok) {
      setCustomerResults([]);
      setStatus("Could not search customers. Try again.");
      return;
    }
    const json = await parseResponseJson<unknown>(res);
    const remoteRows = Array.isArray(json)
      ? json
      : json !== null && typeof json === "object" && "rows" in json && Array.isArray((json as { rows: unknown }).rows)
        ? (json as { rows: unknown[] }).rows
        : [];

    const mapped: LocalCustomer[] = [];
    for (const row of remoteRows) {
      if (row === null || typeof row !== "object") continue;
      const local = customerRowToLocal(row as Record<string, unknown>);
      if (local) {
        await db.customers.put(local);
        mapped.push(local);
      }
    }

    if (mapped.length === 1) {
      await attachCustomer(mapped[0]);
      return;
    }

    if (mapped.length > 1) {
      setCustomerResults(mapped);
      setStatus("");
      return;
    }

    const hint = prefillNewCustomerFromQuery(rawQuery);
    setCustomerResults([]);
    setSelectedCustomer(null);
    setRedeemPoints(0);
    setCreateCustomerOpen(true);
    setNewCustomer((prev) => ({
      name: hint.name || prev.name,
      phone: hint.phone || prev.phone,
      email: "",
      address: "",
      type: "REGULAR",
    }));
    setStatus("No customer found. Enter name and phone below, then create and attach.");
  };

  const loadProductSuggestions = useCallback(
    async (q: string, signal: AbortSignal): Promise<SuggestItem[]> => {
      const n = q.trim().toLowerCase();
      if (!n) return [];
      const local = await db.products
        .filter(
          (p) =>
            p.name.toLowerCase().includes(n) ||
            p.sku.toLowerCase().includes(n) ||
            (p.barcode != null && p.barcode.toLowerCase().includes(n)),
        )
        .limit(8)
        .toArray();
      const fromLocal: SuggestItem[] = local.map((p) => ({
        id: p.id,
        label: p.name,
        description: `SKU ${p.sku}${p.barcode ? ` · ${p.barcode}` : ""}`,
        data: p,
      }));
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        return fromLocal.slice(0, 8);
      }
      if (fromLocal.length >= 8) {
        return fromLocal.slice(0, 8);
      }
      const res = await fetch(`/api/products?q=${encodeURIComponent(q.trim())}`, { signal, cache: "no-store" });
      if (!res.ok) return fromLocal;
      const rows = await parseResponseJson<ApiProductListRow[]>(res);
      const rowList = Array.isArray(rows) ? rows : [];
      const merged = new Map<string, SuggestItem>();
      for (const it of fromLocal) merged.set(it.id, it);
      for (const p of rowList) {
        if (signal.aborted) break;
        const lp = apiListRowToLocal(p);
        merged.set(p.id, {
          id: p.id,
          label: p.name,
          description: `SKU ${p.sku} · EGP ${p.sellPrice.toFixed(2)}`,
          data: lp,
        });
      }
      return Array.from(merged.values()).slice(0, 8);
    },
    [],
  );

  const loadCustomerSuggestions = useCallback(
    async (q: string, signal: AbortSignal): Promise<SuggestItem[]> => {
      const raw = q.trim();
      const normalized = raw.toLowerCase();
      if (!normalized) return [];
      const local = await db.customers
        .filter(
          (c) => c.name.toLowerCase().includes(normalized) || c.phone.toLowerCase().includes(normalized),
        )
        .limit(8)
        .toArray();
      if (local.length > 0 || !online) {
        return local.map((c) => ({
          id: c.id,
          label: c.name,
          description: c.phone,
          data: c,
        }));
      }
      const res = await fetch(
        `/api/customers?q=${encodeURIComponent(raw)}&page=1&pageSize=8`,
        { signal, cache: "no-store" },
      );
      if (!res.ok) return [];
      const json = await parseResponseJson<unknown>(res);
      const remoteRows = Array.isArray(json)
        ? json
        : json !== null && typeof json === "object" && "rows" in json && Array.isArray((json as { rows: unknown }).rows)
          ? (json as { rows: Record<string, unknown>[] }).rows
          : [];
      const out: SuggestItem[] = [];
      for (const row of remoteRows) {
        const localCust = customerRowToLocal(row);
        if (localCust) {
          out.push({
            id: localCust.id,
            label: localCust.name,
            description: localCust.phone,
            data: localCust,
          });
        }
      }
      return out.slice(0, 8);
    },
    [online],
  );

  const createCustomer = async () => {
    if (!online) {
      setStatus("Customer creation requires internet connection.");
      return;
    }
    if (!newCustomer.name.trim() || !newCustomer.phone.trim()) {
      setStatus("Name and phone are required for new customers.");
      return;
    }
    setCreatingCustomer(true);
    setStatus("Creating customer...");
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newCustomer),
      });
      const data = await parseResponseJson<{
        message?: string;
        id?: string;
        name?: string;
        phone?: string;
        type?: string;
        creditBalance?: number;
        loyaltyPoints?: number;
        updatedAt?: string;
      }>(res);
      if (!res.ok) {
        setStatus(errorMessageFromJson(data, "Could not create customer."));
        return;
      }
      if (!data) {
        setStatus("Could not create customer.");
        return;
      }

      const created = {
        id: data.id ?? "",
        name: data.name ?? newCustomer.name.trim(),
        phone: data.phone ?? newCustomer.phone.trim(),
        email: newCustomer.email || undefined,
        creditBalance: Number(data.creditBalance ?? 0),
        loyaltyPoints: Number(data.loyaltyPoints ?? 0),
        type: data.type ?? newCustomer.type,
        syncStatus: "synced" as const,
        updatedAt: data.updatedAt ?? new Date().toISOString(),
      };
      await db.customers.put(created);
      setSelectedCustomer(created);
      setCustomerQuery(created.name);
      setCustomerResults([]);
      setCreateCustomerOpen(false);
      setNewCustomer({ name: "", phone: "", email: "", address: "", type: "REGULAR" });
      setStatus("Customer created and attached.");
    } catch {
      setStatus("Could not create customer.");
    } finally {
      setCreatingCustomer(false);
    }
  };

  const buildInvoiceNumber = () => {
    const now = new Date();
    const datePart = now.toISOString().slice(0, 10).replaceAll("-", "");
    const randomPart = Math.floor(Math.random() * 10000)
      .toString()
      .padStart(4, "0");
    return `INV-${datePart}-${randomPart}`;
  };

  const checkout = async () => {
    if (cart.length === 0 || saving) return;
    setSaving(true);
    setStatus("Saving sale locally...");

    try {
      const createdAt = new Date().toISOString();
      const invoiceNumber = buildInvoiceNumber();
      const subtotal = total;
      const discountAmount = pointsDiscount;
      const taxAmount = 0;
      const netTotal = subtotal - discountAmount + taxAmount;

      if (Math.abs(paymentTotal - netTotal) > 0.009) {
        setStatus(`Payment split total must equal payable total (EGP ${netTotal.toFixed(2)}).`);
        setSaving(false);
        return;
      }

      const storeCreditPayment = paymentSplits
        .filter((payment) => payment.method === "STORE_CREDIT")
        .reduce((sum, payment) => sum + payment.amount, 0);
      if (storeCreditPayment > 0 && !selectedCustomer) {
        setStatus("Attach a customer before using store credit.");
        setSaving(false);
        return;
      }
      if (selectedCustomer && storeCreditPayment > selectedCustomer.creditBalance) {
        setStatus("Store credit exceeds customer credit balance.");
        setSaving(false);
        return;
      }

      const sale = await writeLocal("sales", {
        invoiceNumber,
        customerId: selectedCustomer?.id,
        cashierId: session?.user?.id ?? "local-cashier",
        subtotal,
        discountAmount,
        taxAmount,
        total: netTotal,
        status: "COMPLETED",
        createdAt,
        paymentMethod: paymentSplits.map((p) => p.method).join("+"),
      });

      for (const line of cart) {
        await writeLocal("sale_items", {
          saleId: sale.id,
          productId: line.id,
          productName: line.name,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discount: 0,
          taxRate: 0,
          total: line.quantity * line.unitPrice,
        });

        if (!line.id.startsWith("manual-")) {
          const stockLevel = await db.stock_levels.where("productId").equals(line.id).first();
          if (stockLevel) {
            const newQty = stockLevel.quantity - line.quantity;
            await writeLocal(
              "stock_levels",
              {
                ...stockLevel,
                quantity: newQty,
                _previousQuantity: stockLevel.quantity,
              },
              "UPDATE",
            );
            await writeLocal("stock_movements", {
              productId: line.id,
              locationId: stockLevel.locationId,
              type: "SALE",
              quantity: -line.quantity,
              previousQty: stockLevel.quantity,
              newQty,
              reason: "POS checkout",
              referenceId: sale.id,
              userId: session?.user?.id ?? "local-cashier",
              createdAt,
            });
          }
        }
      }

      for (const payment of paymentSplits) {
        await writeLocal("payments", {
          saleId: sale.id,
          method: payment.method,
          amount: payment.amount,
          reference: payment.reference || undefined,
          createdAt,
        });
      }

      const cashPaymentAmount = paymentSplits
        .filter((payment) => payment.method === "CASH")
        .reduce((sum, payment) => sum + payment.amount, 0);
      if (activeShift && cashPaymentAmount > 0) {
        await writeLocal("cash_shift_entries", {
          shiftId: activeShift.id,
          branchId: activeShift.branchId,
          userId: session?.user?.id ?? "local-cashier",
          type: "SALE_CASH",
          amount: cashPaymentAmount,
          saleId: sale.id,
          note: `Cash sale ${invoiceNumber}`,
          createdAt,
        });
        const nextShift = {
          ...activeShift,
          expectedCash: Number((activeShift.expectedCash + cashPaymentAmount).toFixed(2)),
        };
        await writeLocal("cash_shifts", nextShift, "UPDATE");
        setActiveShift(nextShift);
        setShiftCountedCash(nextShift.expectedCash.toFixed(2));
      }

      if (selectedCustomer) {
        const earnedPoints = loyaltySettings.enabled ? Math.floor(netTotal * loyaltySettings.pointsPerEgp) : 0;
        const updatedCustomer = {
          ...selectedCustomer,
          creditBalance: Number((selectedCustomer.creditBalance - storeCreditPayment).toFixed(2)),
          loyaltyPoints: Math.max(0, selectedCustomer.loyaltyPoints - Math.floor(redeemPoints)) + earnedPoints,
        };
        await writeLocal("customers", updatedCustomer, "UPDATE");
      }

      const receiptCustomer = selectedCustomer
        ? {
            id: selectedCustomer.id,
            name: selectedCustomer.name,
            phone: selectedCustomer.phone,
            ...(selectedCustomer.email ? { email: selectedCustomer.email } : {}),
            type: selectedCustomer.type,
          }
        : null;

      resetAfterCheckout();
      setStatus(
        online ? `Sale ${invoiceNumber} saved and queued for sync.` : `Sale ${invoiceNumber} saved offline and queued.`,
      );
      setLastSale({
        invoiceNumber,
        createdAt,
        payments: paymentSplits,
        lines: cart,
        total: netTotal,
        customer: receiptCustomer,
        loyaltyDiscount: pointsDiscount,
        notes: undefined,
      });
      setHistoryReceipt(null);
      setHistorySaleId(null);
      void loadRecentSales();

      if (online) {
        await syncEngine.flushQueue();
      }
    } catch {
      setStatus("Could not save sale. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const touchBtn =
    "touch-manipulation inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-xl border px-4 py-3 text-base font-semibold active:opacity-90 disabled:pointer-events-none disabled:opacity-50";
  const touchBtnGhost =
    "touch-manipulation inline-flex min-h-[48px] items-center justify-center rounded-xl border px-4 py-3 text-base font-medium active:opacity-90";
  const touchField =
    "touch-manipulation min-h-[48px] rounded-xl border px-4 py-3 text-base";

  return (
    <AppPage className={pageShellClass}>
      <PageHeader title={t.pos.title} subtitle={t.pos.subtitle} />

      <div
        className="mb-5 flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
        style={{ borderColor: "var(--border)", background: "var(--surface-muted)" }}
      >
        <div>
          <p className="text-base font-semibold">{tp.cashierDisplay}</p>
          <p className="mt-0.5 text-sm" style={{ color: "var(--muted)" }}>
            {tp.cashierDisplayHint}
          </p>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-10">
          <label className="flex cursor-pointer items-center gap-3 text-base touch-manipulation">
            <input
              type="checkbox"
              checked={keyboardEnabled}
              onChange={(e) => setKeyboardEnabled(e.target.checked)}
              className="h-7 w-7 shrink-0 rounded-md border touch-manipulation"
              style={{ accentColor: "var(--accent)" }}
            />
            <span>{tp.onScreenKeyboard}</span>
          </label>
          <label className="flex cursor-pointer items-center gap-3 text-base touch-manipulation">
            <input
              type="checkbox"
              checked={kioskMode}
              onChange={(e) => setKioskMode(e.target.checked)}
              className="h-7 w-7 shrink-0 rounded-md border touch-manipulation"
              style={{ accentColor: "var(--accent)" }}
            />
            <span>{tp.largeDisplayMode}</span>
          </label>
        </div>
      </div>

      <div className="pos-layout">
        <div className="pos-main">
      <form onSubmit={onSearch} className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-stretch">
        <SuggestInput
          value={query}
          onChange={setQuery}
          loadSuggestions={loadProductSuggestions}
          onPick={(item) => {
            const raw = item.data;
            const lp =
              raw && typeof raw === "object" && "syncStatus" in (raw as LocalProduct)
                ? (raw as LocalProduct)
                : apiListRowToLocal(raw as ApiProductListRow);
            void db.products.put(lp);
            setFound(lp);
            setQuery(lp.name);
            setStatus(tp.productFound);
          }}
          onFocus={() => {
            if (keyboardEnabled) selectOskTarget({ kind: "query" });
          }}
          placeholder={tp.scanOrSearch}
          autoCapitalize="characters"
          enterKeyHint="search"
          className="w-full flex-1 text-base sm:max-w-xl"
          emptyHint={online ? "No matches — try another term or add a manual line." : "No local matches — connect to search the catalog."}
          minChars={1}
        />
        <Button type="submit" className="min-h-12 shrink-0 px-8 text-base touch-manipulation">
          {tp.search}
        </Button>
      </form>
      <p className="-mt-1 mb-3 text-sm" style={{ color: "var(--muted)" }}>
        Use the barcode scanner or keyboard. Add a manual line if the product is not in the catalog.
      </p>

      {status ? (
        <p className="mb-4 rounded-xl border px-4 py-3 text-base" style={{ borderColor: "var(--border)", background: "var(--surface-muted)", color: "var(--foreground)" }}>
          {status}
        </p>
      ) : null}

      <Card className="mb-5">
        <SectionTitle title="Cash drawer & shift" subtitle="Open a shift before counting cash sales and reconcile it when you close." />
        {activeShift ? (
          <div className="space-y-3">
            <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--surface-muted)" }}>
              <p className="text-base font-semibold">Open shift</p>
              <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                Opened {new Date(activeShift.openedAt).toLocaleString()} · Expected cash EGP {activeShift.expectedCash.toFixed(2)}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_2fr_auto]">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={shiftCountedCash}
                onChange={(e) => setShiftCountedCash(e.target.value)}
                placeholder="Counted cash"
              />
              <div className="rounded-xl border px-4 py-3 text-sm" style={{ borderColor: "var(--border)" }}>
                Variance EGP {(Number(shiftCountedCash || 0) - activeShift.expectedCash).toFixed(2)}
              </div>
              <Input value={shiftNote} onChange={(e) => setShiftNote(e.target.value)} placeholder="Shift close note" />
              <Button type="button" onClick={() => void closeCashShift()}>
                Close shift
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_2fr_auto]">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={shiftOpeningCash}
              onChange={(e) => setShiftOpeningCash(e.target.value)}
              placeholder="Opening cash"
            />
            <Input value={shiftNote} onChange={(e) => setShiftNote(e.target.value)} placeholder="Optional note" />
            <Button type="button" onClick={() => void openCashShift()}>
              Open shift
            </Button>
          </div>
        )}
      </Card>

      <Card className="mb-5">
        <SectionTitle title={tp.customerSection} />
        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
          <SuggestInput
            value={customerQuery}
            onChange={setCustomerQuery}
            loadSuggestions={loadCustomerSuggestions}
            onPick={(item) => {
              const c = item.data as LocalCustomer;
              if (c) void attachCustomer(c);
            }}
            onFocus={() => {
              if (keyboardEnabled) selectOskTarget({ kind: "customerQuery" });
            }}
            placeholder={tp.customerSearch}
            enterKeyHint="search"
            autoComplete="off"
            className="w-full min-h-[48px] flex-1 text-base lg:max-w-md"
            emptyHint={online ? "No matches — press Search to create or search again." : "No local matches."}
            minChars={1}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => {
                void searchCustomers();
              }}
              variant="secondary"
              className="min-h-12 flex-1 px-5 text-base touch-manipulation sm:flex-none"
            >
              {tp.search}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setCreateCustomerOpen((prev) => !prev);
                setNewCustomer((prev) => ({
                  ...prev,
                  phone: prev.phone || customerQuery.trim(),
                }));
              }}
              className="min-h-12 flex-1 px-5 text-base touch-manipulation sm:flex-none"
            >
              {tp.newCustomer}
            </Button>
            {selectedCustomer ? (
              <Button
                type="button"
                onClick={() => {
                  setSelectedCustomer(null);
                  setRedeemPoints(0);
                }}
                variant="secondary"
                className="min-h-12 flex-1 px-5 text-base touch-manipulation sm:flex-none"
              >
                {tp.remove}
              </Button>
            ) : null}
          </div>
        </div>
        <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
          Search attaches automatically when exactly one customer matches. If no one matches, you will be asked to create a new customer.
        </p>
        {createCustomerOpen ? (
          <div className="mt-4 rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--surface-muted)" }}>
            <p className="mb-3 text-base font-semibold">{tp.createCustomer}</p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Input
                value={newCustomer.name}
                onChange={(e) => setNewCustomer((prev) => ({ ...prev, name: e.target.value }))}
                onFocus={() => {
                  if (keyboardEnabled) selectOskTarget({ kind: "newCustomer", field: "name" });
                }}
                placeholder={t.customers.namePlaceholder}
                autoComplete="name"
                className="min-h-[48px] text-base"
              />
              <Input
                value={newCustomer.phone}
                onChange={(e) => setNewCustomer((prev) => ({ ...prev, phone: e.target.value }))}
                onFocus={() => {
                  if (keyboardEnabled) selectOskTarget({ kind: "newCustomer", field: "phone" });
                }}
                placeholder={t.customers.phonePlaceholder}
                inputMode="tel"
                autoComplete="tel"
                className="min-h-[48px] text-base"
              />
              <Input
                value={newCustomer.email}
                onChange={(e) => setNewCustomer((prev) => ({ ...prev, email: e.target.value }))}
                onFocus={() => {
                  if (keyboardEnabled) selectOskTarget({ kind: "newCustomer", field: "email" });
                }}
                placeholder={t.customers.emailPlaceholder}
                inputMode="email"
                className="min-h-[48px] text-base"
              />
              <Input
                value={newCustomer.address}
                onChange={(e) => setNewCustomer((prev) => ({ ...prev, address: e.target.value }))}
                onFocus={() => {
                  if (keyboardEnabled) selectOskTarget({ kind: "newCustomer", field: "address" });
                }}
                placeholder={t.customers.addressPlaceholder}
                className="min-h-[48px] text-base"
              />
              <select
                value={newCustomer.type}
                onChange={(e) =>
                  setNewCustomer((prev) => ({
                    ...prev,
                    type: e.target.value as CreateCustomerPayload["type"],
                  }))
                }
                className="app-input min-h-[48px] text-base"
              >
                <option value="REGULAR">{t.customers.regular}</option>
                <option value="VIP">{t.customers.vip}</option>
                <option value="WHOLESALE">{t.customers.wholesale}</option>
              </select>
              <div className="flex flex-wrap gap-2 md:col-span-2">
                <Button type="button" onClick={() => void createCustomer()} disabled={creatingCustomer} className="min-h-12 flex-1 text-base touch-manipulation sm:flex-none sm:px-8">
                  {creatingCustomer ? tp.creating : tp.createAndAttach}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setCreateCustomerOpen(false)} className="min-h-12 flex-1 text-base touch-manipulation sm:flex-none sm:px-8">
                  {t.actions.cancel}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
        {customerResults.length > 0 ? (
          <ul className="mt-4 space-y-2">
            {customerResults.map((customer) => (
              <li
                key={customer.id}
                className="flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                style={{ borderColor: "var(--border)" }}
              >
                <span className="text-base font-medium">
                  {customer.name} · {customer.phone}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCustomer(customer);
                    setCustomerResults([]);
                    setCustomerQuery(customer.name);
                  }}
                  className={`${touchBtnGhost} shrink-0 touch-manipulation`}
                  style={{ borderColor: "var(--border)", background: "var(--accent)", color: "var(--accent-foreground)" }}
                >
                  {tp.attach}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {selectedCustomer ? (
          <div className="mt-4 rounded-xl border p-4 text-base" style={{ borderColor: "var(--border)", background: "var(--surface-muted)" }}>
            <p className="font-semibold">{selectedCustomer.name}</p>
            <p className="mt-1" style={{ color: "var(--muted)" }}>
              Credit EGP {selectedCustomer.creditBalance.toFixed(2)} · Points {selectedCustomer.loyaltyPoints}
            </p>
            <div className="mt-3">
              <Link
                href={`/customers/${selectedCustomer.id}`}
                className="text-base font-medium underline underline-offset-2 touch-manipulation"
                style={{ color: "var(--accent)" }}
              >
                {tp.openProfile}
              </Link>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <label htmlFor="redeemPoints" className="text-base font-medium">
                {tp.redeemPoints}
              </label>
              <input
                id="redeemPoints"
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={redeemPoints}
                onFocus={() => {
                  if (keyboardEnabled) selectOskTarget({ kind: "redeem" });
                }}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setRedeemPoints(Number.isNaN(n) ? 0 : n);
                }}
                className={`${touchField} w-36 max-w-full`}
                style={{ borderColor: "var(--border)", background: "var(--surface)" }}
              />
              <span className="text-base" style={{ color: "var(--muted)" }}>
                −EGP {pointsDiscount.toFixed(2)}
              </span>
            </div>
          </div>
        ) : null}
      </Card>

      {found ? (
        <div className="mb-5 rounded-2xl border p-4 shadow-sm" style={{ borderColor: "var(--border)", background: "var(--surface-elevated)" }}>
          <p className="text-lg font-semibold leading-tight">{found.name}</p>
          <p className="mt-1 text-base" style={{ color: "var(--muted)" }}>
            SKU {found.sku} · EGP {found.sellPrice.toFixed(2)}
          </p>
          <button
            type="button"
            onClick={() => addToCart(found)}
            className={`${touchBtn} mt-4 w-full touch-manipulation sm:w-auto sm:min-w-[200px]`}
            style={{
              borderColor: "var(--border)",
              background: "var(--accent)",
              color: "var(--accent-foreground)",
            }}
          >
            {tp.addToCart}
          </button>
        </div>
      ) : null}

      <Card className="mb-5">
        <SectionTitle title={tp.manualLine} subtitle={tp.manualLineSubtitle} />
        {!manualOpen ? (
          <button
            type="button"
            onClick={() => setManualOpen(true)}
            className={`${touchBtnGhost} w-full touch-manipulation sm:w-auto`}
            style={{ borderColor: "var(--border)", background: "var(--surface-muted)", color: "var(--foreground)" }}
          >
            {tp.addManualPriceLine}
          </button>
        ) : (
          <div className="mt-2 flex flex-col gap-3">
            <Input
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
              onFocus={() => {
                if (keyboardEnabled) selectOskTarget({ kind: "manualName" });
              }}
              placeholder={tp.descriptionOnReceipt}
              className="w-full text-base"
            />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label htmlFor="manualPrice" className="mb-1 block text-sm font-medium" style={{ color: "var(--muted)" }}>
                  {tp.priceEgp}
                </label>
                <input
                  id="manualPrice"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={manualPrice}
                  onFocus={() => {
                    if (keyboardEnabled) selectOskTarget({ kind: "manualPrice" });
                  }}
                  onChange={(e) => {
                    setManualPrice(e.target.value);
                  }}
                  placeholder="0.00"
                  className="app-input w-full text-base"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={submitManualItem} className="min-h-12 flex-1 px-8 text-base touch-manipulation sm:flex-none">
                  {tp.addLine}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setManualOpen(false);
                    setManualName("");
                    setManualPrice("");
                  }}
                  className="min-h-12 flex-1 px-8 text-base touch-manipulation sm:flex-none"
                >
                  {t.actions.cancel}
                </Button>
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle title={tp.cart} />
        {cart.length === 0 ? (
          <p className="text-base" style={{ color: "var(--muted)" }}>
            {tp.scanToAdd}
          </p>
        ) : (
          <ul className="space-y-3">
            {cart.map((line) => (
              <li
                key={line.id}
                className="flex flex-col gap-3 rounded-xl border px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                style={{ borderColor: "var(--border)", background: "var(--surface-muted)" }}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold leading-snug">{line.name}</p>
                  <p className="mt-0.5 text-sm" style={{ color: "var(--muted)" }}>
                    EGP {line.unitPrice.toFixed(2)} {tp.each}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-end">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label="Decrease quantity"
                      onClick={() => adjustCartLineQuantity(line.id, -1)}
                      className={`${touchBtn} !min-w-[52px] px-0 touch-manipulation`}
                      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
                    >
                      <Minus size={22} strokeWidth={2} aria-hidden />
                    </button>
                    <span className="min-w-[2.5rem] text-center text-lg font-bold tabular-nums">{line.quantity}</span>
                    <button
                      type="button"
                      aria-label="Increase quantity"
                      onClick={() => adjustCartLineQuantity(line.id, 1)}
                      className={`${touchBtn} !min-w-[52px] px-0 touch-manipulation`}
                      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
                    >
                      <Plus size={22} strokeWidth={2} aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label="Remove line"
                      onClick={() => removeCartLine(line.id)}
                      className={`${touchBtn} !min-w-[52px] px-0 touch-manipulation`}
                      style={{ borderColor: "var(--border)", color: "var(--danger)" }}
                    >
                      <Trash2 size={20} strokeWidth={2} aria-hidden />
                    </button>
                  </div>
                  <p className="text-lg font-bold tabular-nums">EGP {(line.quantity * line.unitPrice).toFixed(2)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-5 space-y-4 border-t pt-4" style={{ borderColor: "var(--border)" }}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-lg font-semibold">{tp.payments}</span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => autoBalancePayments(finalTotal)}
                className={`${touchBtnGhost} flex-1 touch-manipulation sm:flex-none`}
                style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--foreground)" }}
              >
                {tp.autoBalance}
              </button>
              <button
                type="button"
                onClick={() => addPaymentSplit(remainingAmount)}
                className={`${touchBtnGhost} flex-1 touch-manipulation sm:flex-none`}
                style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--foreground)" }}
              >
                {tp.addSplit}
              </button>
            </div>
          </div>
          <div className="space-y-3">
            {paymentSplits.map((split, index) => (
              <div
                key={`payment-${index}`}
                className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto]"
              >
                <select
                  value={split.method}
                  onChange={(e) => updatePayment(index, { method: e.target.value })}
                  className="app-input min-h-[48px] text-base"
                >
                  <option value="CASH">{tp.cash}</option>
                  <option value="CARD">{tp.card}</option>
                  <option value="STORE_CREDIT">{tp.storeCredit}</option>
                  <option value="BANK_TRANSFER">{tp.bankTransfer}</option>
                  <option value="VODAFONE_CASH">{tp.vodafoneCash}</option>
                  <option value="FAWRY">{tp.fawry}</option>
                </select>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={
                    keyboardEnabled && oskTarget?.kind === "paymentAmount" && oskTarget.index === index
                      ? paymentAmountOsk
                      : split.amount
                  }
                  onFocus={() => {
                    if (keyboardEnabled) selectPaymentAmountOsk(index);
                  }}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const n = Number(raw);
                    updatePayment(index, { amount: Number.isNaN(n) ? 0 : n });
                    if (keyboardEnabled && oskTarget?.kind === "paymentAmount" && oskTarget.index === index) {
                      setPaymentAmountOsk(raw);
                    }
                  }}
                  className="app-input min-h-[48px] text-base"
                  placeholder={tp.amount}
                />
                <input
                  type="text"
                  value={split.reference ?? ""}
                  onChange={(e) => updatePayment(index, { reference: e.target.value })}
                  onFocus={() => {
                    if (keyboardEnabled) selectOskTarget({ kind: "paymentRef", index });
                  }}
                  className="app-input min-h-[48px] text-base"
                  placeholder={tp.reference}
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => removePaymentSplit(index)}
                  className={`${touchBtnGhost} justify-center touch-manipulation md:min-w-[52px]`}
                  style={{ borderColor: "var(--border)", color: "var(--danger)" }}
                >
                  <Trash2 size={20} className="sm:hidden" aria-hidden />
                  <span className="hidden sm:inline">{tp.removeSplit}</span>
                </button>
              </div>
            ))}
          </div>
          <div className="space-y-1 text-base">
            <p style={{ color: "var(--muted)" }}>
              {tp.paid} EGP {paymentTotal.toFixed(2)} · {tp.due} EGP {finalTotal.toFixed(2)}
            </p>
            <p className="font-semibold" style={{ color: Math.abs(remainingAmount) < 0.01 ? "var(--success)" : "var(--warning)" }}>
              {Math.abs(remainingAmount) < 0.01 ? tp.balanced : `${tp.remaining} EGP ${remainingAmount.toFixed(2)}`}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Button
              type="button"
              onClick={checkout}
              disabled={cart.length === 0 || saving}
              className="min-h-14 w-full justify-center py-4 text-lg font-bold touch-manipulation"
            >
              {saving ? t.actions.saving : tp.checkout}
            </Button>
            <Button
              type="button"
              onClick={holdCurrentTransaction}
              disabled={cart.length === 0 || saving}
              variant="secondary"
              className="min-h-14 w-full justify-center py-4 text-lg font-semibold touch-manipulation"
            >
              {tp.holdSale}
            </Button>
          </div>
        </div>
        <div className="mt-5 rounded-xl border px-4 py-3 text-right text-lg font-bold" style={{ borderColor: "var(--border)", background: "var(--surface-muted)" }}>
          <span className="block text-sm font-normal tabular-nums" style={{ color: "var(--muted)" }}>
            Subtotal EGP {total.toFixed(2)} · Discount EGP {pointsDiscount.toFixed(2)}
          </span>
          {tp.payable} EGP {finalTotal.toFixed(2)}
        </div>
      </Card>

      <Card className="mt-6">
        <SectionTitle title={tp.heldSales} />
        {heldTransactions.length === 0 ? (
          <p className="text-base" style={{ color: "var(--muted)" }}>
            {tp.nothingOnHold}
          </p>
        ) : (
          <ul className="space-y-3">
            {heldTransactions.map((held) => {
              const heldTotal = held.cart.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
              return (
                <li
                  key={held.id}
                  className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div>
                    <p className="text-base font-semibold">{new Date(held.heldAt).toLocaleString()}</p>
                    <p className="mt-1 text-base" style={{ color: "var(--muted)" }}>
                      {held.cart.length} items · EGP {heldTotal.toFixed(2)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => resumeHeldTransaction(held.id)}
                      className={`${touchBtnGhost} min-h-12 flex-1 px-6 text-base touch-manipulation sm:flex-none`}
                      style={{ borderColor: "var(--border)", background: "var(--accent)", color: "var(--accent-foreground)" }}
                    >
                      {tp.resume}
                    </button>
                    <button
                      type="button"
                      onClick={() => discardHeldTransaction(held.id)}
                      className={`${touchBtnGhost} min-h-12 flex-1 px-6 text-base touch-manipulation sm:flex-none`}
                      style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--foreground)" }}
                    >
                      {tp.discard}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {lastSale ? (
        <Card className="mt-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-xl font-semibold">{tp.lastReceipt}</h2>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={printMode}
                onChange={(e) => setPrintMode(e.target.value as "receipt" | "a4")}
                className="app-input min-h-12 min-w-[10rem] flex-1 text-base sm:flex-none"
              >
                <option value="receipt">{tp.receipt80mm}</option>
                <option value="a4">{tp.a4Invoice}</option>
              </select>
              <button
                type="button"
                onClick={() => {
                  setHistoryReceipt(null);
                  setHistorySaleId(null);
                  setTimeout(() => {
                    void printReceipt();
                  }, 120);
                }}
                className={`${touchBtnGhost} min-h-12 flex-1 px-8 text-base touch-manipulation sm:flex-none`}
                style={{ borderColor: "var(--border)", background: "var(--surface-muted)", color: "var(--foreground)" }}
              >
                {tp.print}
              </button>
            </div>
          </div>
          <p className="mt-3 text-base" style={{ color: "var(--muted)" }}>
            {lastSale.invoiceNumber} · {new Date(lastSale.createdAt).toLocaleString()}
            {lastSale.customer ? ` · ${lastSale.customer.name}` : ` · ${tp.walkIn}`}
          </p>
        </Card>
      ) : null}

      <Card className="mt-6">
        <SectionTitle
          title={tp.prevTransactions}
          subtitle={tp.prevTransactionsSubtitle}
        />
        {historyReceipt ? (
          <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            Preview / print queue is showing{" "}
            <strong>{historyReceipt.invoiceNumber}</strong> from history — not the latest checkout unless you clear this.
            <button
              type="button"
              className="ml-3 inline underline decoration-dotted hover:no-underline"
              onClick={() => {
                setHistoryReceipt(null);
                setHistorySaleId(null);
              }}
            >
              Clear history view
            </button>
          </p>
        ) : null}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <select
            value={printMode}
            onChange={(e) => setPrintMode(e.target.value as "receipt" | "a4")}
            className="app-input min-h-11 min-w-[10rem] text-base"
          >
            <option value="receipt">{tp.receipt80mm}</option>
            <option value="a4">{tp.a4Invoice}</option>
          </select>
          <button
            type="button"
            onClick={() => void loadRecentSales()}
            className={`${touchBtnGhost} min-h-11 px-5 text-sm`}
            style={{ borderColor: "var(--border)", background: "var(--surface-muted)", color: "var(--foreground)" }}
          >
            {tp.refreshList}
          </button>
          {!isAdmin ? (
            <span className="text-sm" style={{ color: "var(--muted)" }}>
              Invoice notes: authorized staff only.
            </span>
          ) : null}
        </div>
        {recentSalesLoading ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            {tp.loadingTransactions}
          </p>
        ) : recentSales.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            {tp.noTransactions}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--border)" }}>
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b bg-zinc-50 text-xs uppercase tracking-wide text-zinc-600" style={{ borderColor: "var(--border)" }}>
                  <th className="px-3 py-2 font-semibold">{tp.invoice}</th>
                  <th className="px-3 py-2 font-semibold">{tp.colDate}</th>
                  <th className="px-3 py-2 font-semibold">{tp.colTotal}</th>
                  <th className="px-3 py-2 font-semibold">{tp.colStatus}</th>
                  <th className="px-3 py-2 font-semibold text-end">{tp.colActions}</th>
                </tr>
              </thead>
              <tbody>
                {recentSales.map((sale) => (
                  <tr key={sale.id} className="border-b border-zinc-100 hover:bg-zinc-50/80">
                    <td className="px-3 py-2 font-medium">{sale.invoiceNumber}</td>
                    <td className="px-3 py-2 text-zinc-700">{new Date(sale.createdAt).toLocaleString()}</td>
                    <td className="px-3 py-2">EGP {sale.total.toFixed(2)}</td>
                    <td className="px-3 py-2">
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs">{sale.status}</span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => void printHistoricalInvoice(sale.id)}
                          className={`${touchBtnGhost} min-h-10 px-4 py-2 text-sm`}
                          style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--foreground)" }}
                        >
                          {tp.printInvoice}
                        </button>
                        {isAdmin ? (
                          <button
                            type="button"
                            onClick={() => {
                              setNotesModalSale(sale);
                              setNotesDraft(sale.notes ?? "");
                            }}
                            className={`${touchBtnGhost} min-h-10 px-4 py-2 text-sm`}
                            style={{ borderColor: "var(--border)", background: "var(--surface-muted)", color: "var(--foreground)" }}
                          >
                            {tp.editNotes}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {notesModalSale ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pos-notes-modal-title"
          onClick={() => setNotesModalSale(null)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border bg-white p-5 shadow-xl"
            style={{ borderColor: "var(--border)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="pos-notes-modal-title" className="text-lg font-semibold">
              {tp.invoiceNotesTitle} — {notesModalSale.invoiceNumber}
            </h3>
            <p className="mt-1 text-sm text-zinc-600">
              Shown on printed invoices / A4 reprints for this sale. Leave blank to remove.
            </p>
            <textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              rows={5}
              className="app-input mt-3 min-h-[120px] w-full resize-y rounded-xl px-3 py-2 text-base"
              placeholder="e.g. Warranty registered, corporate billing reference…"
            />
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void saveInvoiceNotes()}
                disabled={notesSaving}
                className={`${touchBtn} px-6 py-2 text-sm`}
                style={{ borderColor: "var(--border)", background: "var(--accent)", color: "var(--accent-foreground)" }}
              >
                {notesSaving ? t.actions.saving : t.actions.save}
              </button>
              <button
                type="button"
                onClick={() => setNotesModalSale(null)}
                className={`${touchBtnGhost} px-6 py-2 text-sm`}
                style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--foreground)" }}
              >
                {t.actions.cancel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="hidden">
        <div
          ref={receiptRef}
          className={`border-2 border-indigo-900 bg-white text-black ${
            printMode === "a4" ? "flex flex-col overflow-hidden box-border" : ""
          }`}
          style={
            printMode === "a4"
              ? {
                  width: "210mm",
                  height: "297mm",
                  maxHeight: "297mm",
                  margin: "0 auto",
                  boxSizing: "border-box",
                }
              : { width: "80mm" }
          }
        >
          {receiptToPrint ? (
            <>
              <div
                className={`shrink-0 border-b-2 border-indigo-900 bg-gradient-to-r from-indigo-950 via-indigo-800 to-indigo-700 text-white ${
                  printMode === "a4" ? "px-6 py-4" : "px-3 py-3"
                }`}
              >
                <div className={`flex items-center ${printMode === "a4" ? "gap-3" : "gap-2"}`}>
                  {storeLogoUrl ? (
                    <Image
                      src={storeLogoUrl}
                      alt="Store logo"
                      width={printMode === "a4" ? 140 : 90}
                      height={printMode === "a4" ? 44 : 30}
                      unoptimized
                      className={printMode === "a4" ? "h-11 w-auto max-w-[170px] object-contain" : "h-8 w-auto max-w-[110px] object-contain"}
                    />
                  ) : null}
                  <div className="min-w-0">
                    <p className={`truncate font-bold ${printMode === "a4" ? "text-xl" : "text-sm"}`}>{storeName}</p>
                    <div className={`mt-0.5 inline-flex items-center gap-1 rounded-full border border-white/40 bg-white/10 font-semibold uppercase tracking-wide ${
                      printMode === "a4" ? "px-3 py-1 text-xs" : "px-2 py-0.5 text-[10px]"
                    }`}>
                      <ReceiptText className={printMode === "a4" ? "h-4 w-4" : "h-3 w-3"} />
                      <span>Sales Receipt</span>
                    </div>
                  </div>
                </div>
                <p className={`mt-2 ${printMode === "a4" ? "text-sm" : "text-[11px]"}`}>{receiptToPrint.invoiceNumber}</p>
                <p className={`${printMode === "a4" ? "text-sm" : "text-[11px]"} opacity-90`}>{new Date(receiptToPrint.createdAt).toLocaleString()}</p>
              </div>
              <div
                className={`shrink-0 border-b border-indigo-200 bg-indigo-50 text-zinc-800 ${
                  printMode === "a4" ? "px-6 py-2 text-sm" : "px-3 py-2 text-[10px] leading-snug"
                }`}
              >
                <p className={`flex items-start gap-2 ${printMode === "a4" ? "font-semibold text-zinc-900" : "font-bold"}`}>
                  <User className={`mt-0.5 shrink-0 text-indigo-700 ${printMode === "a4" ? "h-4 w-4" : "h-3 w-3"}`} />
                  <span>
                    {receiptToPrint.customer ? (
                      <>
                        {receiptToPrint.customer.name}
                        <span className="ml-1.5 font-normal text-zinc-600">
                          ({formatCustomerTypeLabel(receiptToPrint.customer.type)})
                        </span>
                      </>
                    ) : (
                      <>Walk-in — no customer on file</>
                    )}
                  </span>
                </p>
                {receiptToPrint.customer ? (
                  <div className={`mt-1.5 space-y-0.5 ${printMode === "a4" ? "" : "text-[9px] leading-tight"}`}>
                    <p>
                      <span className="text-zinc-500">Phone:</span> {receiptToPrint.customer.phone || "—"}
                    </p>
                    {receiptToPrint.customer.email ? (
                      <p className="break-all">
                        <span className="text-zinc-500">Email:</span> {receiptToPrint.customer.email}
                      </p>
                    ) : null}
                    {printMode === "a4" ? (
                      <p className="text-zinc-600">
                        <span className="text-zinc-500">Customer ref:</span> {receiptToPrint.customer.id}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {(receiptToPrint.loyaltyDiscount ?? 0) > 0 ? (
                  <p className={`mt-2 text-indigo-900 ${printMode === "a4" ? "text-sm" : "text-[9px]"}`}>
                    Loyalty redemption: −EGP {(receiptToPrint.loyaltyDiscount ?? 0).toFixed(2)}
                  </p>
                ) : null}
                {storeCreditFromPayments(receiptToPrint.payments) > 0 ? (
                  <p className={`mt-1 text-indigo-900 ${printMode === "a4" ? "text-sm" : "text-[9px]"}`}>
                    Store credit used: EGP {storeCreditFromPayments(receiptToPrint.payments).toFixed(2)}
                  </p>
                ) : null}
              </div>
              {printMode === "a4" ? (
                <div className="flex min-h-0 flex-1 flex-col px-6 py-3">
                  <div className="a4-invoice-items min-h-0 flex-1 overflow-y-auto print:overflow-hidden">
                    <table className="w-full border border-indigo-900 text-sm">
                      <thead className="sticky top-0 z-[1]">
                        <tr className="bg-indigo-700 text-white">
                          <th className="border border-indigo-900 px-2 py-2 text-left">ITEM</th>
                          <th className="border border-indigo-900 px-2 py-2 text-left">QTY</th>
                          <th className="border border-indigo-900 px-2 py-2 text-right">PRICE</th>
                        </tr>
                      </thead>
                      <tbody>
                        {receiptToPrint.lines.map((line, index) => (
                          <tr key={line.id} className={index % 2 === 0 ? "bg-indigo-50/40" : "bg-white"}>
                            <td className="border border-indigo-900 px-2 py-2">{line.name}</td>
                            <td className="border border-indigo-900 px-2 py-2">{line.quantity}</td>
                            <td className="border border-indigo-900 px-2 py-2 text-right">
                              EGP {(line.unitPrice * line.quantity).toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {(receiptToPrint.loyaltyDiscount ?? 0) > 0 ? (
                    <div className="mt-2 shrink-0 space-y-1 rounded border border-indigo-100 bg-white px-3 py-2 text-sm">
                      <p className="flex justify-between gap-4 text-zinc-700">
                        <span>Subtotal</span>
                        <span>EGP {(receiptToPrint.total + (receiptToPrint.loyaltyDiscount ?? 0)).toFixed(2)}</span>
                      </p>
                      <p className="flex justify-between gap-4 text-indigo-800">
                        <span>Loyalty redemption</span>
                        <span>−EGP {(receiptToPrint.loyaltyDiscount ?? 0).toFixed(2)}</span>
                      </p>
                    </div>
                  ) : null}
                  <div className="mt-2 shrink-0 rounded border border-indigo-200 bg-indigo-50 px-3 py-2 text-right text-sm font-bold">
                    Total: EGP {receiptToPrint.total.toFixed(2)}
                  </div>
                  <div className="mt-2 shrink-0 text-sm">
                    <p className="font-medium">Payments:</p>
                    {receiptToPrint.payments.map((payment, index) => (
                      <p key={`receipt-payment-${index}`}>
                        {payment.method}: EGP {payment.amount.toFixed(2)}
                        {payment.reference ? ` (${payment.reference})` : ""}
                      </p>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="px-3 py-2">
                  <table className="w-full border border-indigo-900 text-[11px]">
                    <thead>
                      <tr className="bg-indigo-700 text-white">
                        <th className="border border-indigo-900 px-1 py-1 text-left">ITEM</th>
                        <th className="border border-indigo-900 px-1 py-1 text-left">QTY</th>
                        <th className="border border-indigo-900 px-1 py-1 text-right">PRICE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {receiptToPrint.lines.map((line, index) => (
                        <tr key={line.id} className={index % 2 === 0 ? "bg-indigo-50/40" : "bg-white"}>
                          <td className="border border-indigo-900 px-1 py-1">{line.name}</td>
                          <td className="border border-indigo-900 px-1 py-1">{line.quantity}</td>
                          <td className="border border-indigo-900 px-1 py-1 text-right">
                            EGP {(line.unitPrice * line.quantity).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {(receiptToPrint.loyaltyDiscount ?? 0) > 0 ? (
                    <div className="mt-2 space-y-0.5 rounded border border-indigo-100 bg-white px-2 py-1 text-[10px] leading-tight">
                      <p className="flex justify-between gap-2 text-zinc-700">
                        <span>Subtotal</span>
                        <span>EGP {(receiptToPrint.total + (receiptToPrint.loyaltyDiscount ?? 0)).toFixed(2)}</span>
                      </p>
                      <p className="flex justify-between gap-2 text-indigo-800">
                        <span>Loyalty</span>
                        <span>−EGP {(receiptToPrint.loyaltyDiscount ?? 0).toFixed(2)}</span>
                      </p>
                    </div>
                  ) : null}
                  <div className="mt-2 rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-right text-xs font-bold">
                    Total: EGP {receiptToPrint.total.toFixed(2)}
                  </div>
                  <div className="mt-2 text-[11px]">
                    <p className="font-medium">Payments:</p>
                    {receiptToPrint.payments.map((payment, index) => (
                      <p key={`receipt-payment-${index}`}>
                        {payment.method}: EGP {payment.amount.toFixed(2)}
                        {payment.reference ? ` (${payment.reference})` : ""}
                      </p>
                    ))}
                  </div>
                </div>
              )}
              {receiptToPrint.notes?.trim() ? (
                <div
                  className={`shrink-0 border-t border-dashed border-amber-300/80 bg-amber-50 text-zinc-900 ${
                    printMode === "a4" ? "px-6 py-2 text-sm" : "px-3 py-2 text-[9px] leading-snug"
                  }`}
                >
                  <p className={`font-semibold text-amber-950 ${printMode === "a4" ? "" : "text-[10px]"}`}>
                    Invoice notes
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">{receiptToPrint.notes.trim()}</p>
                </div>
              ) : null}
              <div className={`shrink-0 border-t border-indigo-200 bg-indigo-50 text-zinc-700 ${
                printMode === "a4" ? "px-6 py-3 text-xs" : "px-3 py-2 text-[10px]"
              }`}>
                <div className="flex flex-wrap items-center gap-1">
                  <span className={`inline-flex items-center gap-1 rounded border border-indigo-200 bg-white ${
                    printMode === "a4" ? "px-2 py-1" : "px-1.5 py-0.5"
                  }`}>
                    <Phone className={printMode === "a4" ? "h-3.5 w-3.5 text-indigo-700" : "h-2.5 w-2.5 text-indigo-700"} />
                    <span>{storePhone || "-"}</span>
                  </span>
                  <span className={`inline-flex items-center gap-1 rounded border border-indigo-200 bg-white ${
                    printMode === "a4" ? "px-2 py-1" : "px-1.5 py-0.5"
                  }`}>
                    <Globe className={printMode === "a4" ? "h-3.5 w-3.5 text-indigo-700" : "h-2.5 w-2.5 text-indigo-700"} />
                    <span>{storeWebsite || "-"}</span>
                  </span>
                  <span className={`inline-flex items-center gap-1 rounded border border-indigo-200 bg-white ${
                    printMode === "a4" ? "px-2 py-1" : "px-1.5 py-0.5"
                  }`}>
                    <AtSign className={printMode === "a4" ? "h-3.5 w-3.5 text-indigo-700" : "h-2.5 w-2.5 text-indigo-700"} />
                    <span>{storeInstagram || "-"}</span>
                  </span>
                </div>
                <p className="mt-1">Thank you for choosing {storeName}.</p>
              </div>
            </>
          ) : null}
        </div>
      </div>

        </div>

        {keyboardEnabled ? (
          <aside className="pos-keys-aside">
            <PosSoftKeyboard
              activeTarget={oskTarget}
              onSelectTarget={selectOskTarget}
              onKey={applyOskKey}
              largeKeys={kioskMode}
            />
          </aside>
        ) : null}
      </div>
    </AppPage>
  );
}
