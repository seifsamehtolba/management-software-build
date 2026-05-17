"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { ComponentCategory } from "@prisma/client";
import Image from "next/image";
import { SuggestInput, type SuggestItem } from "@/components/ui/SuggestInput";
import { errorMessageFromJson, parseResponseJson } from "@/lib/parseResponseJson";

type PCComponent = {
  name: string;
  brand: string;
  model?: string;
  category: string;
  specs: Record<string, string>;
  imageUrl?: string;
  barcode?: string;
  externalUrl?: string;
  suggestedPrice?: number;
  sourcePriceText?: string;
};

const categoryOptions = [
  { label: "All Categories", value: "" },
  { label: "CPU", value: "cpu" },
  { label: "GPU", value: "gpu" },
  { label: "RAM", value: "ram" },
  { label: "Storage", value: "storage" },
  { label: "Motherboard", value: "motherboard" },
  { label: "PSU", value: "psu" },
  { label: "Case", value: "case" },
  { label: "Cooler", value: "cooler" },
  { label: "Monitor", value: "monitor" },
  { label: "Keyboard", value: "keyboard" },
  { label: "Mouse", value: "mouse" },
];

function inferComponentCategory(value: string): ComponentCategory | undefined {
  const normalized = value.toLowerCase();
  if (normalized === "cpu") return "CPU";
  if (normalized === "gpu") return "GPU";
  if (normalized === "ram") return "RAM";
  if (normalized === "storage") return "STORAGE_SSD";
  if (normalized === "motherboard") return "MOTHERBOARD";
  if (normalized === "psu") return "PSU";
  if (normalized === "case") return "CASE";
  if (normalized === "cooler") return "COOLER";
  if (normalized === "monitor") return "MONITOR";
  if (normalized === "keyboard") return "KEYBOARD";
  if (normalized === "mouse") return "MOUSE";
  return "OTHER";
}

export function AddProductModal({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState(() => query);
  const queryDebounceSkip = useRef(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState<PCComponent[]>([]);
  const [selected, setSelected] = useState<PCComponent | null>(null);
  const [costPrice, setCostPrice] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [sku, setSku] = useState("");
  const [reorderPoint, setReorderPoint] = useState("3");
  const [status, setStatus] = useState("");

  const margin = useMemo(() => {
    const cost = Number(costPrice);
    const sell = Number(sellPrice);
    if (!Number.isFinite(cost) || !Number.isFinite(sell) || cost <= 0) return null;
    return ((sell - cost) / cost) * 100;
  }, [costPrice, sellPrice]);

  const canSave = Number(costPrice) > 0 && Number(sellPrice) > 0 && selected?.name?.trim();

  useEffect(() => {
    if (!queryDebounceSkip.current) {
      queryDebounceSkip.current = true;
      return;
    }
    const timer = setTimeout(() => setDebouncedQuery(query), 350);
    return () => clearTimeout(timer);
  }, [query]);

  const fetchComponentResults = useCallback(
    async (q: string, signal: AbortSignal) => {
      const params = new URLSearchParams({ q });
      if (category) params.set("category", category);
      const res = await fetch(`/api/components/search?${params.toString()}`, { signal });
      const data = await parseResponseJson<{ results?: PCComponent[]; message?: string }>(res);
      if (!res.ok) {
        return { ok: false as const, message: errorMessageFromJson(data, "Search failed.") };
      }
      return { ok: true as const, results: Array.isArray(data?.results) ? data.results : [] };
    },
    [category],
  );

  useEffect(() => {
    const q = debouncedQuery.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setStatus("");
    void (async () => {
      try {
        const out = await fetchComponentResults(q, ac.signal);
        if (ac.signal.aborted) return;
        if (!out.ok) {
          setStatus(out.message);
          setResults([]);
        } else {
          setResults(out.results);
        }
      } catch {
        if (ac.signal.aborted) return;
        setStatus("Search failed. You can still add manually.");
        setResults([]);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();
    return () => ac.abort();
  }, [debouncedQuery, fetchComponentResults]);

  const loadComponentSuggestions = useCallback(
    async (q: string, signal: AbortSignal): Promise<SuggestItem[]> => {
      const out = await fetchComponentResults(q.trim(), signal);
      if (!out.ok) return [];
      return out.results.slice(0, 12).map((item, index) => ({
        id: `${item.name}-${item.brand}-${index}`,
        label: item.name,
        description: [item.brand, item.category].filter(Boolean).join(" · "),
        data: item,
      }));
    },
    [fetchComponentResults],
  );

  const goManual = () => {
    const baseCategory = category || "other";
    setSelected({
      name: query.trim() || "New Component",
      brand: "",
      category: baseCategory,
      specs: {},
    });
    setStep(2);
  };

  const saveComponent = async () => {
    if (!selected || !canSave) return;
    setSaving(true);
    setStatus("");
    try {
      const payload = {
        name: selected.name,
        brand: selected.brand || undefined,
        category: selected.category || undefined,
        componentCategory: inferComponentCategory(selected.category || category || "other"),
        specs: selected.specs,
        imageUrl: selected.imageUrl,
        barcode: selected.barcode,
        externalRef: selected.externalUrl,
        suggestedPriceUsd: selected.suggestedPrice,
        costPrice: Number(costPrice),
        sellPrice: Number(sellPrice),
        sku: sku.trim() || undefined,
        reorderPoint: Number(reorderPoint) || 3,
      };

      const res = await fetch("/api/components/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await parseResponseJson<{ message?: string }>(res);
      if (!res.ok) {
        setStatus(errorMessageFromJson(data, "Save failed."));
        return;
      }
      setOpen(false);
      setStep(1);
      setResults([]);
      setSelected(null);
      setCostPrice("");
      setSellPrice("");
      setSku("");
      setReorderPoint("3");
      onSuccess();
    } catch {
      setStatus("Save failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" className="rounded border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-100">
          Add Component
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[95vw] max-w-3xl -translate-x-1/2 -translate-y-1/2 rounded border bg-white p-5 shadow-lg">
          <Dialog.Title className="text-lg font-semibold">Add PC Component</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-zinc-600">
            Search globally, then set local EGP pricing before save.
          </Dialog.Description>

          {step === 1 ? (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-[200px_1fr_auto]">
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="rounded border px-3 py-2 text-sm"
                >
                  {categoryOptions.map((item) => (
                    <option key={item.value || "all"} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <SuggestInput
                  value={query}
                  onChange={setQuery}
                  loadSuggestions={loadComponentSuggestions}
                  onPick={(item) => {
                    setSelected(item.data as PCComponent);
                    setStep(2);
                  }}
                  placeholder="Search by name or scan barcode..."
                  minChars={2}
                  className="rounded border px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() => setDebouncedQuery(query)}
                  className="rounded bg-zinc-900 px-4 py-2 text-sm text-white"
                >
                  {loading ? "Searching..." : "Search"}
                </button>
              </div>

              {results.length === 0 && !loading ? (
                <p className="text-sm text-zinc-600">No results found — you can add it manually.</p>
              ) : null}

              <ul className="max-h-80 space-y-2 overflow-auto">
                {results.map((item, index) => (
                  <li
                    key={`${item.name}-${index}`}
                    className="cursor-pointer rounded border px-3 py-2 hover:bg-zinc-50"
                    onClick={() => {
                      setSelected(item);
                      setStep(2);
                    }}
                  >
                    <div className="flex items-center gap-3">
                      {item.imageUrl ? (
                        <Image
                          src={item.imageUrl}
                          alt={item.name}
                          width={48}
                          height={48}
                          unoptimized
                          className="h-12 w-12 rounded object-contain"
                        />
                      ) : (
                        <div className="h-12 w-12 rounded border bg-zinc-100" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{item.name}</p>
                        <p className="text-sm text-zinc-600">
                          {item.brand || "Unknown"} • {item.category || "other"}
                        </p>
                        {item.model ? <p className="text-xs text-zinc-500">Model: {item.model}</p> : null}
                        {typeof item.suggestedPrice === "number" ? (
                          <p className="text-xs text-zinc-500">
                            Market ref: {item.sourcePriceText ?? `$${item.suggestedPrice.toFixed(2)} USD`} — reference only
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={goManual}
                className="rounded border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100"
              >
                + Add manually instead
              </button>
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="rounded border bg-zinc-50 p-3">
                <div className="flex gap-3">
                  {selected?.imageUrl ? (
                    <Image
                      src={selected.imageUrl}
                      alt={selected.name}
                      width={64}
                      height={64}
                      unoptimized
                      className="h-16 w-16 rounded object-contain"
                    />
                  ) : (
                    <div className="h-16 w-16 rounded border bg-white" />
                  )}
                  <div className="min-w-0">
                    <p className="font-medium">{selected?.name}</p>
                    <p className="text-sm text-zinc-600">
                      {selected?.brand || "Unknown"} • {selected?.category || "other"}
                    </p>
                    {selected?.model ? <p className="text-xs text-zinc-500">Model: {selected.model}</p> : null}
                    <div className="mt-1 space-y-0.5">
                      {Object.entries(selected?.specs ?? {})
                        .slice(0, 5)
                        .map(([key, value]) => (
                          <p key={key} className="text-xs text-zinc-600">
                            {key}: {value}
                          </p>
                        ))}
                    </div>
                  </div>
                </div>
              </div>

              {typeof selected?.suggestedPrice === "number" ? (
                <p className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">
                  💡 Market reference: ~${selected.suggestedPrice.toFixed(2)} USD — set your EGP prices below
                </p>
              ) : null}

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium">Cost Price (EGP)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={costPrice}
                    onChange={(e) => setCostPrice(e.target.value)}
                    className="w-full rounded border px-3 py-2 text-sm"
                  />
                  <p className="mt-1 text-xs text-zinc-500">What you paid the supplier</p>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Sell Price (EGP)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={sellPrice}
                    onChange={(e) => setSellPrice(e.target.value)}
                    className="w-full rounded border px-3 py-2 text-sm"
                  />
                  <p className="mt-1 text-xs text-zinc-500">What you charge the customer</p>
                </div>
              </div>

              {margin !== null ? (
                <p className={`text-sm font-medium ${margin > 0 ? "text-green-600" : "text-red-600"}`}>
                  Margin: {margin.toFixed(1)}%
                </p>
              ) : null}

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium">SKU (auto-generated if left empty)</label>
                  <input
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    className="w-full rounded border px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Reorder Point</label>
                  <input
                    type="number"
                    min="0"
                    value={reorderPoint}
                    onChange={(e) => setReorderPoint(e.target.value)}
                    className="w-full rounded border px-3 py-2 text-sm"
                  />
                </div>
              </div>

              {status ? <p className="text-sm text-zinc-600">{status}</p> : null}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="rounded border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-100"
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={!canSave || saving}
                  onClick={() => {
                    void saveComponent();
                  }}
                  className="rounded bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-60"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
