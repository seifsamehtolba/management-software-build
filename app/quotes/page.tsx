"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useReactToPrint } from "react-to-print";
import { AtSign, Building2, CalendarDays, Globe, MapPin, Phone, ReceiptText } from "lucide-react";
import { AppPage, Button, Card, EmptyState, Input, PageHeader, SectionTitle, Select } from "@/components/ui/primitives";
import { SuggestInput, type SuggestItem } from "@/components/ui/SuggestInput";
import { errorMessageFromJson, parseResponseJson } from "@/lib/parseResponseJson";
import { hasPermission, PERMISSIONS, normalizePermissions } from "@/lib/permissions";
import { useLang } from "@/lib/i18n";

type BranchOption = {
  id: string;
  name: string;
};

type ProductResult = {
  id: string;
  sku: string;
  name: string;
  categoryName: string;
  sellPrice: number;
  componentCategory?: string | null;
  availableQty: number;
  purchasePriceOptions: Array<{
    unitCost: number;
    receivedQty: number;
    lastReceivedAt: string | null;
  }>;
};

type QuoteRow = {
  key: string;
  label: string;
  description: string;
  price: string;
  productId?: string;
};

type PriceDecisionState = {
  open: boolean;
  product: ProductResult | null;
  rowKey: string;
  selectedCost: string;
  qty: string;
  clientUnitPrice: string;
};

type QuoteRecord = {
  id: string;
  quoteNumber: string;
  status: "DRAFT" | "SENT" | "APPROVED" | "REJECTED" | "EXPIRED" | "CONVERTED";
  title: string;
  clientName: string | null;
  clientPhone: string | null;
  branchId: string | null;
  subtotal: number;
  total: number;
  validUntil?: string | null;
  sentAt?: string | null;
  lastReminderAt?: string | null;
  nextReminderAt?: string | null;
  reminderCount?: number;
  convertedSaleId?: string | null;
  items: Array<{
    categoryKey: string;
    categoryLabel: string;
    description: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    productId: string | null;
  }>;
};

const defaultRows: QuoteRow[] = [
  { key: "CPU", label: "CPU", description: "", price: "" },
  { key: "MOTHERBOARD", label: "Mother Board", description: "", price: "" },
  { key: "MEMORY", label: "Memory", description: "", price: "" },
  { key: "GPU", label: "Graphic Card", description: "", price: "" },
  { key: "SSD_NVME", label: "Ssd / Nvme", description: "", price: "" },
  { key: "PSU", label: "Power Supply", description: "", price: "" },
  { key: "CASE", label: "Case", description: "", price: "" },
  { key: "COOLING", label: "Cooling", description: "", price: "" },
  { key: "MONITOR", label: "Monitor", description: "", price: "" },
  { key: "KEYBOARD", label: "KeyBoard", description: "", price: "" },
  { key: "MOUSE", label: "Mouse", description: "", price: "" },
  { key: "HEADSET", label: "Headset", description: "", price: "" },
  { key: "OTHER", label: "Other", description: "", price: "" },
  { key: "NOTES", label: "Notes", description: "", price: "" },
];

function guessCategoryKey(product: ProductResult): string {
  const comp = (product.componentCategory ?? "").toUpperCase();
  if (comp === "CPU") return "CPU";
  if (comp === "MOTHERBOARD") return "MOTHERBOARD";
  if (comp === "RAM") return "MEMORY";
  if (comp === "GPU") return "GPU";
  if (comp === "STORAGE_SSD" || comp === "STORAGE_HDD") return "SSD_NVME";
  if (comp === "PSU") return "PSU";
  if (comp === "CASE") return "CASE";
  if (comp === "COOLER" || comp === "CASE_FAN") return "COOLING";
  if (comp === "MONITOR") return "MONITOR";
  if (comp === "KEYBOARD") return "KEYBOARD";
  if (comp === "MOUSE") return "MOUSE";

  const name = `${product.name} ${product.categoryName}`.toLowerCase();
  if (name.includes("cpu") || name.includes("processor")) return "CPU";
  if (name.includes("mother")) return "MOTHERBOARD";
  if (name.includes("ram") || name.includes("memory")) return "MEMORY";
  if (name.includes("gpu") || name.includes("graphic") || name.includes("rtx") || name.includes("gtx")) return "GPU";
  if (name.includes("ssd") || name.includes("nvme") || name.includes("hdd") || name.includes("storage")) return "SSD_NVME";
  if (name.includes("psu") || name.includes("power supply")) return "PSU";
  if (name.includes("case")) return "CASE";
  if (name.includes("cool") || name.includes("fan")) return "COOLING";
  if (name.includes("monitor") || name.includes("display")) return "MONITOR";
  if (name.includes("keyboard")) return "KEYBOARD";
  if (name.includes("mouse")) return "MOUSE";
  if (name.includes("headset") || name.includes("headphone")) return "HEADSET";

  return "OTHER";
}

function formatDaysSince(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const days = Math.floor((Date.now() - t) / 86_400_000);
  return `${days}d ago`;
}

function formatExpiresIn(iso: string | null | undefined): string {
  if (!iso) return "Open-ended";
  const until = new Date(iso).getTime();
  if (Number.isNaN(until)) return "—";
  const ms = until - Date.now();
  if (ms < 0) return "Expired";
  const days = Math.ceil(ms / 86_400_000);
  if (days <= 1) return "< 24h";
  return `in ${days}d`;
}

export default function QuotesPage() {
  const { t, lang } = useLang();
  const tq = t.quotes;
  const { data: session } = useSession();
  const canRunBatchJobs = hasPermission(
    normalizePermissions(session?.user?.permissions ?? []),
    PERMISSIONS.quotesJobsRun,
  );

  const [storeName, setStoreName] = useState("Store");
  const [storeLogoUrl, setStoreLogoUrl] = useState("");
  const [storePhone, setStorePhone] = useState("");
  const [storeAddresses, setStoreAddresses] = useState<string[]>([]);
  const [storeWebsite, setStoreWebsite] = useState("");
  const [storeInstagram, setStoreInstagram] = useState("");
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [branchId, setBranchId] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [quoteTitle, setQuoteTitle] = useState("Price Quote");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState(() => search);
  const searchDebounceSkip = useRef(false);
  const [inventoryCategory, setInventoryCategory] = useState("");
  const [results, setResults] = useState<ProductResult[]>([]);
  const [loadingResults, setLoadingResults] = useState(false);
  const [targetRow, setTargetRow] = useState(defaultRows[0].key);
  const [rows, setRows] = useState<QuoteRow[]>(defaultRows);
  const [savedQuotes, setSavedQuotes] = useState<QuoteRecord[]>([]);
  const [activeQuoteId, setActiveQuoteId] = useState("");
  const [activeQuoteStatus, setActiveQuoteStatus] = useState<QuoteRecord["status"] | "UNSAVED">("UNSAVED");
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [workflowMessage, setWorkflowMessage] = useState("");
  const [followUpFilter, setFollowUpFilter] = useState<"" | "due" | "overdue" | "recent">("");
  const [draggingProductId, setDraggingProductId] = useState<string>("");
  const [priceDecision, setPriceDecision] = useState<PriceDecisionState>({
    open: false,
    product: null,
    rowKey: defaultRows[0].key,
    selectedCost: "",
    qty: "1",
    clientUnitPrice: "",
  });

  const loadStoreSettings = useCallback(async () => {
    const settingsRes = await fetch("/api/settings/store", { cache: "no-store" });
    if (!settingsRes.ok) return;
    const settings = await parseResponseJson<{
      storeName: string;
      storeLogoUrl: string;
      storePhone?: string;
      storeAddresses?: string[];
      storeWebsite?: string;
      storeInstagram?: string;
    }>(settingsRes);
    if (!settings) return;
    setStoreName(settings.storeName || "Store");
    setStoreLogoUrl(settings.storeLogoUrl || "");
    setStorePhone(settings.storePhone ?? "");
    setStoreAddresses(Array.isArray(settings.storeAddresses) ? settings.storeAddresses : []);
    setStoreWebsite(settings.storeWebsite ?? "");
    setStoreInstagram(settings.storeInstagram ?? "");
  }, []);

  useEffect(() => {
    const timer = setTimeout(async () => {
      const [, branchesRes] = await Promise.all([loadStoreSettings(), fetch("/api/branches")]);
      if (branchesRes.ok) {
        const data = await parseResponseJson<BranchOption[]>(branchesRes);
        setBranches(Array.isArray(data) ? data : []);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [loadStoreSettings]);

  useEffect(() => {
    if (!searchDebounceSkip.current) {
      searchDebounceSkip.current = true;
      return;
    }
    const timer = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const runSearch = useCallback(async () => {
    setLoadingResults(true);
    try {
      const params = new URLSearchParams();
      const trimmedSearch = debouncedSearch.trim();
      if (trimmedSearch.length >= 2) {
        params.set("q", trimmedSearch);
      }
      if (branchId) params.set("branchId", branchId);
      const res = await fetch(`/api/quotes/inventory?${params.toString()}`);
      if (!res.ok) {
        setResults([]);
        return;
      }
      const data = await parseResponseJson<ProductResult[]>(res);
      setResults(Array.isArray(data) ? data.slice(0, 20) : []);
    } finally {
      setLoadingResults(false);
    }
  }, [branchId, debouncedSearch]);

  useEffect(() => {
    void runSearch();
  }, [runSearch]);

  const loadInventorySuggestions = useCallback(
    async (q: string, signal: AbortSignal): Promise<SuggestItem[]> => {
      const params = new URLSearchParams();
      if (q.trim().length >= 2) {
        params.set("q", q.trim());
      }
      if (branchId) params.set("branchId", branchId);
      const res = await fetch(`/api/quotes/inventory?${params.toString()}`, { signal });
      if (!res.ok) return [];
      const data = await parseResponseJson<ProductResult[]>(res);
      if (!Array.isArray(data)) return [];
      return data.slice(0, 12).map((p) => ({
        id: p.id,
        label: p.name,
        description: `${p.sku} · ${p.availableQty} in stock · EGP ${p.sellPrice.toFixed(2)}`,
        data: p,
      }));
    },
    [branchId],
  );

  const applyProductToRow = (
    product: ProductResult,
    rowKeyOverride?: string,
    qtyOverride = 1,
    clientUnitPriceOverride?: number,
    selectedCostOverride?: number,
  ) => {
    const rowKey = rowKeyOverride || guessCategoryKey(product);
    const qty = Number.isFinite(qtyOverride) && qtyOverride > 0 ? qtyOverride : 1;
    const unitCharge = clientUnitPriceOverride && clientUnitPriceOverride > 0 ? clientUnitPriceOverride : product.sellPrice;
    const costTag = selectedCostOverride && selectedCostOverride > 0 ? ` | Cost basis EGP ${selectedCostOverride.toFixed(2)}` : "";
    setRows((prev) =>
      prev.map((row) =>
        row.key === rowKey
          ? {
              ...row,
              description: `${product.name} (${product.sku}) x${qty}${costTag}`,
              price: (qty * unitCharge).toFixed(2),
              productId: product.id,
            }
          : row,
      ),
    );
    setTargetRow(rowKey);
  };

  const promptPricingDecision = (product: ProductResult, rowKeyOverride?: string) => {
    const rowKey = rowKeyOverride || guessCategoryKey(product);
    if (product.purchasePriceOptions.length <= 1) {
      const selectedCost = product.purchasePriceOptions[0]?.unitCost;
      applyProductToRow(product, rowKey, 1, product.sellPrice, selectedCost);
      return;
    }

    setPriceDecision({
      open: true,
      product,
      rowKey,
      selectedCost: product.purchasePriceOptions[0].unitCost.toFixed(2),
      qty: "1",
      clientUnitPrice: product.sellPrice.toFixed(2),
    });
  };

  const onDragStartProduct = (product: ProductResult) => (event: React.DragEvent<HTMLLIElement>) => {
    event.dataTransfer.setData("application/json", JSON.stringify(product));
    event.dataTransfer.effectAllowed = "copy";
    setDraggingProductId(product.id);
  };

  const onDragEndProduct = () => {
    setDraggingProductId("");
  };

  const onDropToRow = (event: React.DragEvent<HTMLTableCellElement>) => {
    event.preventDefault();
    const raw = event.dataTransfer.getData("application/json");
    if (!raw) return;
    try {
      const product = JSON.parse(raw) as ProductResult;
        // Drag-and-drop always auto-categorizes to the detected hardware row.
        promptPricingDecision(product);
    } catch {
      // Ignore malformed drag payloads.
    }
  };

  const grandTotal = useMemo(
    () =>
      rows.reduce((sum, row) => {
        const n = Number(row.price);
        return Number.isFinite(n) ? sum + n : sum;
      }, 0),
    [rows],
  );

  const printRef = useRef<HTMLDivElement>(null);
  const onPrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `${quoteTitle.replace(/\s+/g, "-").toLowerCase()}-${new Date().toISOString().slice(0, 10)}`,
    pageStyle: `
      @page {
        size: A4 portrait;
        margin: 0;
      }
      @media print {
        html, body {
          width: 210mm;
          height: 297mm;
          margin: 0;
          padding: 0;
          overflow: hidden;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .quote-print-lines {
          overflow: hidden !important;
        }
      }
    `,
  });

  const handlePrint = async () => {
    await loadStoreSettings();
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 60);
    });
    onPrint();
  };

  const whatsappHref = useMemo(() => {
    const branchName = branchId ? branches.find((b) => b.id === branchId)?.name ?? "Branch" : "All Branches";
    const lineSummary = rows
      .filter((row) => row.description.trim())
      .map((row) => `- ${row.label}: ${row.description}${row.price ? ` (EGP ${row.price})` : ""}`)
      .join("\n");
    const body = [
      `${quoteTitle}`,
      `Date: ${new Date().toLocaleDateString()}`,
      `Branch: ${branchName}`,
      `Client: ${clientName || "-"}`,
      "",
      "Items:",
      lineSummary || "- No items yet",
      "",
      `Total: EGP ${grandTotal.toFixed(2)}`,
      "",
      `Prepared by ${storeName}`,
    ].join("\n");
    const encodedText = encodeURIComponent(body);
    const phoneDigits = clientPhone.replace(/\D/g, "");
    if (phoneDigits.length >= 8) {
      return `https://wa.me/${phoneDigits}?text=${encodedText}`;
    }
    return `https://wa.me/?text=${encodedText}`;
  }, [branchId, branches, clientName, clientPhone, grandTotal, quoteTitle, rows, storeName]);

  const instagramHandle = useMemo(() => {
    const raw = storeInstagram.trim();
    if (!raw) return "";
    return raw.startsWith("@") ? raw : `@${raw}`;
  }, [storeInstagram]);

  const inventoryCategories = useMemo(() => {
    return Array.from(new Set(results.map((item) => item.categoryName))).sort((a, b) => a.localeCompare(b));
  }, [results]);

  const filteredResults = useMemo(() => {
    if (!inventoryCategory) return results;
    return results.filter((item) => item.categoryName === inventoryCategory);
  }, [results, inventoryCategory]);

  const groupedResults = useMemo(() => {
    const map = new Map<string, ProductResult[]>();
    for (const item of filteredResults) {
      const key = item.categoryName || "Uncategorized";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredResults]);

  const categoryTree = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of results) {
      const key = item.categoryName || "Uncategorized";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [results]);

  const applyQuoteToEditor = useCallback((quote: QuoteRecord) => {
    const rowMap = new Map(
      quote.items.map((item) => [
        item.categoryKey,
        {
          description: item.description,
          price: item.lineTotal > 0 ? item.lineTotal.toFixed(2) : "",
          productId: item.productId ?? undefined,
        },
      ]),
    );
    setRows(
      defaultRows.map((row) => ({
        ...row,
        description: rowMap.get(row.key)?.description ?? "",
        price: rowMap.get(row.key)?.price ?? "",
        productId: rowMap.get(row.key)?.productId,
      })),
    );
    setQuoteTitle(quote.title || "Price Quote");
    setClientName(quote.clientName ?? "");
    setClientPhone(quote.clientPhone ?? "");
    setBranchId(quote.branchId ?? "");
    setActiveQuoteId(quote.id);
    setActiveQuoteStatus(quote.status);
  }, []);

  const fetchQuotes = useCallback(async () => {
    const params = new URLSearchParams();
    if (branchId) params.set("branchId", branchId);
    if (followUpFilter) {
      params.set("followUp", followUpFilter);
    }
    const res = await fetch(`/api/quotes?${params.toString()}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = await parseResponseJson<QuoteRecord[]>(res);
    setSavedQuotes(Array.isArray(data) ? data : []);
  }, [branchId, followUpFilter]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchQuotes();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchQuotes]);

  const activeSavedQuote = useMemo(
    () => savedQuotes.find((q) => q.id === activeQuoteId),
    [savedQuotes, activeQuoteId],
  );

  const buildQuotePayload = useCallback(() => {
    const rowsPayload = rows.map((row, index) => {
      const lineTotal = Number(row.price || 0);
      const quantity = row.key === "NOTES" ? 1 : 1;
      const unitPrice = quantity > 0 ? lineTotal / quantity : lineTotal;
      return {
        categoryKey: row.key,
        categoryLabel: row.label,
        description: row.description || "",
        quantity,
        unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
        productId: row.productId,
        position: index,
      };
    });
    return {
      title: quoteTitle || "Price Quote",
      branchId: branchId || undefined,
      clientName: clientName || undefined,
      clientPhone: clientPhone || undefined,
      items: rowsPayload,
    };
  }, [branchId, clientName, clientPhone, quoteTitle, rows]);

  const saveDraft = async () => {
    setWorkflowBusy(true);
    setWorkflowMessage("Saving draft...");
    try {
      const payload = buildQuotePayload();
      const res = await fetch(activeQuoteId ? `/api/quotes/${activeQuoteId}` : "/api/quotes", {
        method: activeQuoteId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, status: "DRAFT" }),
      });
      const data = await parseResponseJson<QuoteRecord | { message?: string }>(res);
      if (!res.ok) {
        setWorkflowMessage(errorMessageFromJson(data, "Failed to save draft"));
        return;
      }
      if (!data || !("id" in data)) {
        setWorkflowMessage("Failed to save draft");
        return;
      }
      const quote = data as QuoteRecord;
      setActiveQuoteId(quote.id);
      setActiveQuoteStatus(quote.status);
      setWorkflowMessage(`Draft saved (${quote.quoteNumber})`);
      await fetchQuotes();
    } finally {
      setWorkflowBusy(false);
    }
  };

  const runQuoteAction = async (action: "send" | "approve" | "convert") => {
    if (!activeQuoteId) {
      setWorkflowMessage("Save draft first.");
      return;
    }
    setWorkflowBusy(true);
    setWorkflowMessage(`${action === "send" ? "Sending" : action === "approve" ? "Approving" : "Converting"} quote...`);
    try {
      const res = await fetch(`/api/quotes/${activeQuoteId}/${action}`, {
        method: "POST",
      });
      const data = await parseResponseJson<
        QuoteRecord | { message?: string; sale?: { invoiceNumber?: string } }
      >(res);
      if (!res.ok) {
        setWorkflowMessage(errorMessageFromJson(data, "Action failed"));
        return;
      }
      if (!data) {
        setWorkflowMessage("Action failed");
        return;
      }

      if (action === "convert") {
        setActiveQuoteStatus("CONVERTED");
        const saleInvoice = (data as { sale?: { invoiceNumber?: string } }).sale?.invoiceNumber;
        setWorkflowMessage(saleInvoice ? `Converted to sale ${saleInvoice}` : "Quote converted to sale.");
      } else {
        const quote = data as QuoteRecord;
        setActiveQuoteStatus(quote.status);
        setWorkflowMessage(`Quote ${quote.status.toLowerCase()} successfully.`);
      }
      await fetchQuotes();
    } finally {
      setWorkflowBusy(false);
    }
  };

  const sendReminder = async () => {
    if (!activeQuoteId || activeQuoteStatus !== "SENT") {
      setWorkflowMessage("Select a sent quote to send a reminder.");
      return;
    }
    setWorkflowBusy(true);
    setWorkflowMessage("Sending reminder...");
    try {
      const res = await fetch(`/api/quotes/${activeQuoteId}/remind`, { method: "POST" });
      const data = await parseResponseJson<{ whatsAppHref?: string; message?: string; quote?: QuoteRecord }>(res);
      if (!res.ok) {
        setWorkflowMessage(errorMessageFromJson(data, "Reminder failed"));
        return;
      }
      const href = data?.whatsAppHref;
      setWorkflowMessage(data?.message ?? "Reminder logged. Open WhatsApp to send.");
      if (href) {
        window.open(href, "_blank", "noopener,noreferrer");
      }
      await fetchQuotes();
    } finally {
      setWorkflowBusy(false);
    }
  };

  const runExpireQuotes = async () => {
    setWorkflowBusy(true);
    setWorkflowMessage("Expiring stale quotes...");
    try {
      const res = await fetch("/api/quotes/expire", { method: "POST" });
      const data = await parseResponseJson<{ scanned?: number; expired?: number; message?: string }>(res);
      if (!res.ok) {
        setWorkflowMessage(errorMessageFromJson(data, "Expire job failed"));
        return;
      }
      setWorkflowMessage(`Expired ${data?.expired ?? 0} of ${data?.scanned ?? 0} scanned quotes.`);
      await fetchQuotes();
    } finally {
      setWorkflowBusy(false);
    }
  };

  const runBatchReminders = async () => {
    setWorkflowBusy(true);
    setWorkflowMessage("Running reminder batch...");
    try {
      const res = await fetch("/api/quotes/reminders/run", { method: "POST" });
      const data = await parseResponseJson<{
        scanned?: number;
        dueCount?: number;
        reminders?: Array<{ whatsAppHref: string }>;
        message?: string;
      }>(res);
      if (!res.ok) {
        setWorkflowMessage(errorMessageFromJson(data, "Batch reminders failed"));
        return;
      }
      setWorkflowMessage(`Processed ${data?.dueCount ?? 0} due reminder(s) from ${data?.scanned ?? 0} sent quotes.`);
      const first = data?.reminders?.[0]?.whatsAppHref;
      if (first) {
        window.open(first, "_blank", "noopener,noreferrer");
      }
      await fetchQuotes();
    } finally {
      setWorkflowBusy(false);
    }
  };

  return (
    <AppPage>
      <PageHeader title={t.quotes.title} subtitle={t.quotes.subtitle} />

      <Card className="mb-4">
        <SectionTitle title={tq.quoteMeta} />
        <div className="mb-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--muted)" }}>{tq.followUpQueue}</p>
          <div className="flex flex-wrap gap-2">
            {(
              [
                { key: "" as const, labelKey: "allQuotes" as const },
                { key: "due" as const, labelKey: "dueExpiring" as const },
                { key: "overdue" as const, labelKey: "overdueValidity" as const },
                { key: "recent" as const, labelKey: "recentlySent" as const },
              ] as const
            ).map(({ key, labelKey }) => (
              <button
                key={key || "all-list"}
                type="button"
                onClick={() => setFollowUpFilter(key)}
                className={`rounded-md border px-3 py-1.5 text-sm ${
                  followUpFilter === key ? "border-transparent text-white" : "hover:bg-zinc-50"
                }`}
                style={{
                  borderColor: followUpFilter === key ? "transparent" : "var(--border)",
                  background: followUpFilter === key ? "var(--accent)" : undefined,
                }}
              >
                {tq[labelKey]}
              </button>
            ))}
          </div>
        </div>
        <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_auto]">
          <Select
            value={activeQuoteId}
            onChange={(event) => {
              const selected = savedQuotes.find((quote) => quote.id === event.target.value);
              if (selected) {
                applyQuoteToEditor(selected);
              } else {
                setActiveQuoteId("");
                setActiveQuoteStatus("UNSAVED");
              }
            }}
          >
            <option value="">{tq.newUnsavedQuote}</option>
            {savedQuotes.map((quote) => (
              <option key={quote.id} value={quote.id}>
                {quote.quoteNumber} - {quote.clientName || "Walk-in"} ({quote.status}
                {quote.reminderCount ? ` • ${quote.reminderCount} rm` : ""})
              </option>
            ))}
          </Select>
          <Button type="button" variant="secondary" onClick={() => void fetchQuotes()}>
            {tq.refreshQuotes}
          </Button>
          <p className="rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>{tq.statusLabel}: {activeQuoteStatus}</p>
        </div>
        {activeSavedQuote && activeQuoteId ? (
          <div className="mb-3 flex flex-wrap gap-2 text-xs" style={{ color: "var(--muted)" }}>
            <span className="rounded-full border px-2 py-0.5" style={{ borderColor: "var(--border)" }}>
              {tq.sentLabel}: {formatDaysSince(activeSavedQuote.sentAt)}
            </span>
            <span className="rounded-full border px-2 py-0.5" style={{ borderColor: "var(--border)" }}>
              {tq.validLabel}: {formatExpiresIn(activeSavedQuote.validUntil)}
            </span>
            <span className="rounded-full border px-2 py-0.5" style={{ borderColor: "var(--border)" }}>
              {tq.remindersLabel}: {activeSavedQuote.reminderCount ?? 0}
            </span>
            {activeSavedQuote.lastReminderAt ? (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-900">
                {tq.lastNudge}: {formatDaysSince(activeSavedQuote.lastReminderAt)}
              </span>
            ) : null}
          </div>
        ) : null}
        {activeQuoteStatus === "SENT" && (activeSavedQuote?.reminderCount ?? 0) > 0 ? (
          <p className="mb-3 rounded border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-950">
            Client was reminded — follow up on WhatsApp, then <strong>Approve</strong> when they confirm so you can convert to
            sale.
          </p>
        ) : null}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          <Input
            value={quoteTitle}
            onChange={(event) => setQuoteTitle(event.target.value)}
            placeholder={tq.quoteTitle}
          />
          <Input
            value={clientName}
            onChange={(event) => setClientName(event.target.value)}
            placeholder={tq.clientName}
          />
          <Input
            value={clientPhone}
            onChange={(event) => setClientPhone(event.target.value)}
            placeholder={tq.clientPhone}
          />
          <Select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
            <option value="">{tq.allBranches}</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" onClick={() => void saveDraft()} disabled={workflowBusy}>
            {workflowBusy ? tq.processing : tq.saveDraft}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void runQuoteAction("send")}
            disabled={workflowBusy || !activeQuoteId || activeQuoteStatus !== "DRAFT"}
          >
            {tq.markSent}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void runQuoteAction("approve")}
            disabled={workflowBusy || !activeQuoteId || activeQuoteStatus !== "SENT"}
          >
            {tq.approve}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void runQuoteAction("convert")}
            disabled={workflowBusy || !activeQuoteId || activeQuoteStatus !== "APPROVED"}
          >
            {tq.convertToSale}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void sendReminder()}
            disabled={workflowBusy || !activeQuoteId || activeQuoteStatus !== "SENT"}
          >
            {tq.sendReminderWA}
          </Button>
          {canRunBatchJobs ? (
            <>
              <Button type="button" variant="secondary" onClick={() => void runBatchReminders()} disabled={workflowBusy}>
                {tq.runDueReminders}
              </Button>
              <Button type="button" variant="secondary" onClick={() => void runExpireQuotes()} disabled={workflowBusy}>
                {tq.expireStaleQuotes}
              </Button>
            </>
          ) : null}
        </div>
        {workflowMessage ? <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>{workflowMessage}</p> : null}
      </Card>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[260px_1fr_1fr]">
        <Card>
          <SectionTitle title={tq.categories} subtitle={tq.inventoryBrowser} />
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setInventoryCategory("")}
              className={`w-full rounded-md border px-3 py-2 text-start text-sm ${
                inventoryCategory === "" ? "border-transparent text-white" : "hover:bg-zinc-50"
              }`}
              style={{
                borderColor: inventoryCategory === "" ? "transparent" : "var(--border)",
                background: inventoryCategory === "" ? "var(--accent)" : undefined,
              }}
            >
              {tq.allCategories} ({results.length})
            </button>
            {categoryTree.map(([name, count]) => (
              <button
                key={name}
                type="button"
                onClick={() => setInventoryCategory(name)}
                className={`w-full rounded-md border px-3 py-2 text-start text-sm ${
                  inventoryCategory === name ? "border-transparent text-white" : "hover:bg-zinc-50"
                }`}
                style={{
                  borderColor: inventoryCategory === name ? "transparent" : "var(--border)",
                  background: inventoryCategory === name ? "var(--accent)" : undefined,
                }}
              >
                {name} ({count})
              </button>
            ))}
          </div>
        </Card>

        <Card>
          <SectionTitle title={tq.components} />
          <div className="grid grid-cols-1 gap-2 md:grid-cols-[2fr_1fr_auto]">
            <SuggestInput
              value={search}
              onChange={setSearch}
              loadSuggestions={loadInventorySuggestions}
              onPick={(item) => promptPricingDecision(item.data as ProductResult)}
              placeholder="Search components by name / SKU / barcode"
              minChars={2}
            />
            <Select value={targetRow} onChange={(event) => setTargetRow(event.target.value)}>
              {rows
                .filter((row) => row.key !== "NOTES")
                .map((row) => (
                  <option key={row.key} value={row.key}>
                    {row.label}
                  </option>
                ))}
            </Select>
            <Button type="button" onClick={() => setDebouncedSearch(search)} variant="secondary">
              {loadingResults ? t.actions.loading : t.actions.search}
            </Button>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto]">
            <Select value={inventoryCategory} onChange={(event) => setInventoryCategory(event.target.value)}>
              <option value="">{tq.allCategories}</option>
              {inventoryCategories.map((categoryName) => (
                <option key={categoryName} value={categoryName}>
                  {categoryName}
                </option>
              ))}
            </Select>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setSearch("");
                setDebouncedSearch("");
              }}
            >
              {tq.browseInventory}
            </Button>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            Search by keyword, or browse by inventory category. Drag any item card and drop it on the quote sheet. If an item has
            multiple buy prices, you will pick cost source + quantity + client charge.
          </p>
          {groupedResults.length > 0 ? (
            <div className="mt-3 max-h-[32rem] space-y-4 overflow-auto pr-1">
              {groupedResults.map(([categoryName, categoryItems]) => (
                <div key={categoryName}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    {categoryName} ({categoryItems.length})
                  </p>
                  <ul className="space-y-2">
                    {categoryItems.map((product) => (
                      <li
                        key={product.id}
                        draggable
                        onDragStart={onDragStartProduct(product)}
                        onDragEnd={onDragEndProduct}
                        className={`cursor-grab rounded border p-2 text-sm active:cursor-grabbing ${
                          draggingProductId === product.id ? "opacity-60" : ""
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="font-medium">{product.name}</p>
                            <p className="text-zinc-600">
                              {product.sku} • In stock: {product.availableQty} • Sell: EGP {product.sellPrice.toFixed(2)}
                            </p>
                            {product.purchasePriceOptions.length > 1 ? (
                              <p className="text-xs text-amber-700">
                                {product.purchasePriceOptions.length} historical buy prices found. You will choose one on add.
                              </p>
                            ) : null}
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => promptPricingDecision(product, targetRow)}
                              className="rounded border px-3 py-1 text-sm"
                              style={{ borderColor: "var(--border)" }}
                            >
                              {tq.addToSelectedRow}
                            </button>
                            <button
                              type="button"
                              onClick={() => promptPricingDecision(product)}
                              className="rounded border px-3 py-1 text-sm"
                              style={{ borderColor: "var(--border)" }}
                            >
                              {tq.autoCategory}
                            </button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title={t.empty.noResults} subtitle={t.empty.noResultsHint} />
          )}
        </Card>

        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">{tq.clientQuoteSheet}</h2>
            <div className="flex gap-2">
              <Button type="button" onClick={() => void handlePrint()}>
                {tq.printSavePdf}
              </Button>
              <a
                href={whatsappHref}
                target="_blank"
                rel="noreferrer"
                className="rounded bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700"
              >
                {tq.shareWhatsApp}
              </a>
            </div>
          </div>
          <p className="mb-2 text-sm font-medium">{tq.totalLabel}: EGP {grandTotal.toFixed(2)}</p>
          <div className="overflow-x-auto">
            <table className="min-w-full border text-sm" style={{ borderColor: "var(--border)" }}>
              <thead>
                <tr style={{ background: "var(--surface)" }}>
                  <th className="border px-2 py-2 text-start" style={{ borderColor: "var(--border)" }}>{tq.categoryCol}</th>
                  <th className="border px-2 py-2 text-start" style={{ borderColor: "var(--border)" }}>{tq.itemDescriptionCol}</th>
                  <th className="border px-2 py-2 text-start" style={{ borderColor: "var(--border)" }}>{tq.priceCol}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.key}>
                    <td className="border px-2 py-1 font-medium">{row.label}</td>
                    <td className={`border px-2 py-1 ${draggingProductId ? "bg-indigo-50" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={onDropToRow}>
                      <input
                        value={row.description}
                        onChange={(event) =>
                          setRows((prev) => prev.map((item, i) => (i === index ? { ...item, description: event.target.value } : item)))
                        }
                        className="w-full rounded border px-2 py-1"
                        placeholder="Drop item here or type details"
                      />
                    </td>
                    <td className="border px-2 py-1">
                      {row.key === "NOTES" ? (
                        <input
                          value={row.price}
                          onChange={(event) =>
                            setRows((prev) => prev.map((item, i) => (i === index ? { ...item, price: event.target.value } : item)))
                          }
                          className="w-full rounded border px-2 py-1"
                          placeholder="Optional"
                        />
                      ) : (
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={row.price}
                          onChange={(event) =>
                            setRows((prev) => prev.map((item, i) => (i === index ? { ...item, price: event.target.value } : item)))
                          }
                          className="w-full rounded border px-2 py-1"
                          placeholder="0.00"
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      <div className="hidden">
        <div
          ref={printRef}
          className="box-border flex max-h-[297mm] flex-col overflow-hidden border-[3px] border-indigo-900 bg-white text-black"
          style={{ width: "210mm", height: "297mm", maxHeight: "297mm", margin: "0 auto", boxSizing: "border-box" }}
        >
          <div className="relative shrink-0 overflow-hidden border-b-2 border-indigo-900 bg-gradient-to-r from-indigo-950 via-indigo-800 to-indigo-700 px-6 py-4 text-white">
            <div className="absolute right-4 top-4 h-24 w-24 rounded-full border border-white/25 bg-white/10" />
            <div className="absolute -right-8 -top-10 h-44 w-44 rounded-full border border-white/15 bg-white/5" />
            <div className="relative flex items-start justify-between">
              <div className="flex items-center gap-3 pr-6">
                {storeLogoUrl ? (
                  <Image
                    src={storeLogoUrl}
                    alt="Store logo"
                    width={132}
                    height={46}
                    unoptimized
                    className="h-12 w-auto max-w-[180px] object-contain"
                  />
                ) : null}
                <div>
                  <h3 className="text-2xl font-bold tracking-wide">{storeName}</h3>
                  <div className="mt-1 inline-flex items-center gap-1 rounded-full border border-white/40 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide">
                    <ReceiptText className="h-3.5 w-3.5" />
                    <span>{quoteTitle}</span>
                  </div>
                </div>
              </div>
              <div className="space-y-2 text-right text-xs leading-5">
                <div className="inline-flex items-center gap-1 rounded-full border border-white/35 bg-white/10 px-2 py-0.5">
                  <CalendarDays className="h-3.5 w-3.5" />
                  <span>{new Date().toLocaleDateString()}</span>
                </div>
                <div className="inline-flex items-center gap-1 rounded-full border border-white/35 bg-white/10 px-2 py-0.5">
                  <Building2 className="h-3.5 w-3.5" />
                  <span>{branchId ? branches.find((b) => b.id === branchId)?.name ?? "Branch" : "All Branches"}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="shrink-0 border-b border-indigo-200 bg-indigo-50 px-6 py-2 text-sm">
            <span className="mr-6">
              <strong>Client:</strong> {clientName || "-"}
            </span>
            <span>
              <strong>Phone:</strong> {clientPhone || "-"}
            </span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col px-6 py-4">
            <div className="quote-print-lines min-h-0 flex-1 overflow-y-auto print:overflow-hidden">
              <table className="w-full border-2 border-indigo-900 text-sm">
              <thead className="sticky top-0 z-[1]">
                <tr className="bg-indigo-700 text-white">
                  <th className="border border-indigo-900 px-2 py-2 text-left">CATEGORY</th>
                  <th className="border border-indigo-900 px-2 py-2 text-left">ITEM DESCRIPTION</th>
                  <th className="border border-indigo-900 px-2 py-2 text-left">PRICE</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={`print-${row.key}`} className={index % 2 === 0 ? "bg-indigo-50/40" : "bg-white"}>
                    <td className="border border-indigo-900 bg-indigo-50 px-2 py-2 font-semibold">{row.label}</td>
                    <td className="border border-indigo-900 px-2 py-2">{row.description || "-"}</td>
                    <td className="border border-indigo-900 px-2 py-2 font-semibold">{row.price ? `EGP ${row.price}` : "-"}</td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>
            <div className="mt-3 flex shrink-0 items-center justify-between gap-4">
              <p className="text-xs text-zinc-600">This quotation is valid for 3 days unless stock/price changes.</p>
              <div className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-bold text-indigo-950">
                Total: EGP {grandTotal.toFixed(2)}
              </div>
            </div>
          </div>
          <div className="shrink-0 border-t border-indigo-200 bg-indigo-50 px-6 py-2 text-[11px] text-zinc-700">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded border border-indigo-200 bg-white px-2 py-1">
                <Phone className="h-3 w-3 text-indigo-700" />
                <span>{storePhone || "-"}</span>
              </span>
              <span className="inline-flex items-center gap-1 rounded border border-indigo-200 bg-white px-2 py-1">
                <Globe className="h-3 w-3 text-indigo-700" />
                <span>{storeWebsite || "-"}</span>
              </span>
              <span className="inline-flex items-center gap-1 rounded border border-indigo-200 bg-white px-2 py-1">
                <AtSign className="h-3 w-3 text-indigo-700" />
                <span>{instagramHandle || "-"}</span>
              </span>
            </div>
            <div className="mt-1 inline-flex items-start gap-1">
              <MapPin className="mt-0.5 h-3 w-3 shrink-0 text-indigo-700" />
              <span>{storeAddresses.length > 0 ? storeAddresses.join(" | ") : "-"}</span>
            </div>
            <div className="mt-1">Thank you for choosing {storeName}. For confirmation, reply on WhatsApp or visit your nearest branch.</div>
          </div>
        </div>
      </div>

      {priceDecision.open && priceDecision.product ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl rounded border p-4 shadow-lg" style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
            <h3 className="text-lg font-semibold">{tq.choosePriceSource}</h3>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              {priceDecision.product.name} ({priceDecision.product.sku})
            </p>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
              <label className="text-sm">
                <span className="mb-1 block">{tq.buyPriceSource}</span>
                <select
                  value={priceDecision.selectedCost}
                  onChange={(event) => setPriceDecision((prev) => ({ ...prev, selectedCost: event.target.value }))}
                  className="w-full rounded border px-2 py-2"
                >
                  {priceDecision.product.purchasePriceOptions.map((option) => (
                    <option key={`${option.unitCost}-${option.lastReceivedAt ?? "x"}`} value={option.unitCost.toFixed(2)}>
                      EGP {option.unitCost.toFixed(2)} (received {option.receivedQty}
                      {option.lastReceivedAt ? `, last ${new Date(option.lastReceivedAt).toLocaleDateString()}` : ""})
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block">{tq.quantityForClient}</span>
                <input
                  type="number"
                  min="1"
                  max={priceDecision.product.availableQty}
                  value={priceDecision.qty}
                  onChange={(event) => setPriceDecision((prev) => ({ ...prev, qty: event.target.value }))}
                  className="w-full rounded border px-2 py-2"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block">{tq.clientUnitCharge}</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={priceDecision.clientUnitPrice}
                  onChange={(event) => setPriceDecision((prev) => ({ ...prev, clientUnitPrice: event.target.value }))}
                  className="w-full rounded border px-2 py-2"
                />
              </label>
            </div>
            {(() => {
              const selectedCost = Number(priceDecision.selectedCost) || 0;
              const qty = Math.max(1, Number(priceDecision.qty) || 1);
              const clientUnit = Math.max(0, Number(priceDecision.clientUnitPrice) || 0);
              const unitProfit = clientUnit - selectedCost;
              const totalProfit = unitProfit * qty;
              const marginPct = selectedCost > 0 ? (unitProfit / selectedCost) * 100 : 0;
              const good = unitProfit >= 0;
              return (
                <div className={`mt-3 rounded border p-3 text-sm ${good ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}>
                  <p>
                    <strong>Unit:</strong> Cost EGP {selectedCost.toFixed(2)} {"->"} Charge EGP {clientUnit.toFixed(2)} {"->"} Profit EGP{" "}
                    {unitProfit.toFixed(2)}
                  </p>
                  <p>
                    <strong>Total ({qty} pcs):</strong> Profit EGP {totalProfit.toFixed(2)}{" "}
                    {selectedCost > 0 ? `(${marginPct.toFixed(1)}% margin)` : ""}
                  </p>
                </div>
              );
            })()}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() =>
                  setPriceDecision({
                    open: false,
                    product: null,
                    rowKey: defaultRows[0].key,
                    selectedCost: "",
                    qty: "1",
                    clientUnitPrice: "",
                  })
                }
                className="rounded border px-3 py-2 text-sm"
              style={{ borderColor: "var(--border)" }}
              >
                {t.actions.cancel}
              </button>
              <button
                type="button"
                onClick={() => {
                  const product = priceDecision.product;
                  if (!product) return;
                  const qty = Math.min(
                    Math.max(1, Number(priceDecision.qty) || 1),
                    Math.max(1, product.availableQty || 1),
                  );
                  const unitCharge = Math.max(0.01, Number(priceDecision.clientUnitPrice) || product.sellPrice);
                  const selectedCost = Number(priceDecision.selectedCost) || undefined;
                  applyProductToRow(product, priceDecision.rowKey, qty, unitCharge, selectedCost);
                  setPriceDecision({
                    open: false,
                    product: null,
                    rowKey: defaultRows[0].key,
                    selectedCost: "",
                    qty: "1",
                    clientUnitPrice: "",
                  });
                }}
                className="rounded px-3 py-2 text-sm text-white"
                style={{ background: "var(--accent)" }}
              >
                {tq.applyToQuote}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AppPage>
  );
}
