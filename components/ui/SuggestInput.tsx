"use client";

import {
  type InputHTMLAttributes,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

export type SuggestItem = {
  id: string;
  label: string;
  description?: string;
  data?: unknown;
};

export type SuggestInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  loadSuggestions: (query: string, signal: AbortSignal) => Promise<SuggestItem[]>;
  onPick?: (item: SuggestItem) => void;
  debounceMs?: number;
  minChars?: number;
  maxSuggestions?: number;
  emptyHint?: string;
};

export function SuggestInput({
  value,
  onChange,
  loadSuggestions,
  onPick,
  debounceMs = 280,
  minChars = 1,
  maxSuggestions = 12,
  emptyHint,
  className,
  onFocus,
  onBlur,
  onKeyDown,
  disabled,
  ...rest
}: SuggestInputProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<SuggestItem[]>([]);
  const [highlight, setHighlight] = useState(-1);

  const scheduleFetch = useCallback(
    (q: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
      const trimmed = q.trim();
      if (trimmed.length < minChars) {
        setItems([]);
        setLoading(false);
        setHighlight(-1);
        return;
      }

      debounceRef.current = setTimeout(async () => {
        abortRef.current?.abort();
        const ac = new AbortController();
        abortRef.current = ac;
        setLoading(true);
        try {
          const next = await loadSuggestions(trimmed, ac.signal);
          setItems(next.slice(0, maxSuggestions));
          setHighlight(next.length > 0 ? 0 : -1);
        } catch {
          if (ac.signal.aborted) return;
          setItems([]);
          setHighlight(-1);
        } finally {
          if (!ac.signal.aborted) setLoading(false);
        }
      }, debounceMs);
    },
    [debounceMs, loadSuggestions, maxSuggestions, minChars],
  );

  useEffect(() => {
    scheduleFetch(value);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, [value, scheduleFetch]);

  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      const el = rootRef.current;
      if (!el || !(e.target instanceof Node) || el.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

  const pick = useCallback(
    (item: SuggestItem) => {
      onPick?.(item);
      setOpen(false);
      setHighlight(-1);
    },
    [onPick],
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;

    if (!open && items.length > 0 && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      setOpen(true);
      setHighlight(0);
      e.preventDefault();
      return;
    }

    if (!open || items.length === 0) {
      if (e.key === "Escape") setOpen(false);
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h < items.length - 1 ? h + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h <= 0 ? items.length - 1 : h - 1));
    } else if (e.key === "Enter") {
      if (highlight >= 0 && items[highlight]) {
        e.preventDefault();
        pick(items[highlight]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setHighlight(-1);
    }
  };

  const showPanel = open && (items.length > 0 || !!emptyHint || loading);
  const inputClass = ["app-input w-full min-w-0", className].filter(Boolean).join(" ");

  return (
    <div ref={rootRef} className="relative w-full min-w-0">
      <input
        ref={inputRef}
        {...rest}
        type={rest.type ?? "text"}
        role="combobox"
        aria-expanded={showPanel}
        aria-controls={listId}
        aria-autocomplete="list"
        disabled={disabled}
        className={inputClass}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={(e) => {
          onFocus?.(e);
          setOpen(true);
        }}
        onBlur={(e) => {
          onBlur?.(e);
        }}
        onKeyDown={handleKeyDown}
      />
      {showPanel ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-[60] mt-1 max-h-56 w-full overflow-auto rounded-xl border py-1 shadow-lg"
          style={{
            borderColor: "var(--border)",
            background: "var(--surface-elevated)",
            boxShadow: "var(--shadow-md)",
          }}
        >
          {loading ? (
            <li className="px-3 py-2 text-sm" style={{ color: "var(--muted)" }}>
              Searching…
            </li>
          ) : null}
          {!loading &&
            items.map((item, i) => (
              <li key={item.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={highlight === i}
                  className="flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm transition hover:opacity-95"
                  style={{
                    background: highlight === i ? "color-mix(in srgb, var(--accent) 18%, transparent)" : "transparent",
                    color: "var(--foreground)",
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(item);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                >
                  <span className="font-medium">{item.label}</span>
                  {item.description ? (
                    <span className="text-xs" style={{ color: "var(--muted)" }}>
                      {item.description}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          {!loading && items.length === 0 && emptyHint ? (
            <li className="px-3 py-2 text-sm" style={{ color: "var(--muted)" }}>
              {emptyHint}
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
