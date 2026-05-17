"use client";

import { useState } from "react";
import { ArrowBigUp, Delete, Space } from "lucide-react";

export type PosOskTarget =
  | { kind: "query" }
  | { kind: "customerQuery" }
  | { kind: "manualName" }
  | { kind: "manualPrice" }
  | { kind: "redeem" }
  | { kind: "paymentAmount"; index: number }
  | { kind: "paymentRef"; index: number }
  | { kind: "newCustomer"; field: "name" | "phone" | "email" | "address" };

function labelForTarget(t: PosOskTarget | null): string {
  if (!t) return "Tap a field below";
  if (t.kind === "query") return "Product search";
  if (t.kind === "customerQuery") return "Customer search";
  if (t.kind === "manualName") return "Manual description";
  if (t.kind === "manualPrice") return "Manual line price";
  if (t.kind === "redeem") return "Loyalty points";
  if (t.kind === "paymentAmount") return `Payment ${t.index + 1} amount`;
  if (t.kind === "paymentRef") return `Payment ${t.index + 1} reference`;
  return `New customer · ${t.field}`;
}

type Props = {
  activeTarget: PosOskTarget | null;
  onSelectTarget: (t: PosOskTarget | null) => void;
  onKey: (action: string) => void;
  largeKeys?: boolean;
};

const ROWS_LOWER = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["z", "x", "c", "v", "b", "n", "m"],
];

export function PosSoftKeyboard({ activeTarget, onSelectTarget, onKey, largeKeys }: Props) {
  const [shift, setShift] = useState(false);
  const keySize = largeKeys
    ? "min-h-[44px] min-w-[32px] px-1.5 text-lg font-semibold"
    : "min-h-[40px] min-w-[28px] px-1 text-base font-semibold";

  const emit = (action: string) => {
    onKey(action);
    if (shift && action.length === 1 && /[a-zA-Z]/.test(action)) setShift(false);
  };

  return (
    <div
      className="rounded-2xl border p-3 shadow-md"
      style={{
        borderColor: "var(--border)",
        background: "var(--surface-elevated)",
        boxShadow: "var(--shadow-md)",
      }}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
            Keyboard
          </p>
          <p className="mt-0.5 text-sm font-medium leading-tight">{labelForTarget(activeTarget)}</p>
        </div>
        <button
          type="button"
          onClick={() => onSelectTarget(null)}
          className="touch-manipulation rounded-lg border px-2 py-1 text-xs font-medium active:opacity-90"
          style={{ borderColor: "var(--border)", color: "var(--muted)" }}
        >
          Clear focus
        </button>
      </div>

      <div className="mb-2 grid grid-cols-10 gap-1">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].map((d) => (
          <button
            key={d}
            type="button"
            disabled={!activeTarget}
            onClick={() => emit(d)}
            className={`touch-manipulation rounded-lg border active:opacity-90 disabled:pointer-events-none disabled:opacity-35 ${keySize}`}
            style={{
              borderColor: "var(--border)",
              background: "var(--surface-muted)",
              color: "var(--foreground)",
            }}
          >
            {d}
          </button>
        ))}
      </div>

      <div className="mb-2 flex flex-wrap justify-center gap-1">
        {[".", ",", "-", "@", "'", '"'].map((sym, i) => (
          <button
            key={`punct-${i}-${sym}`}
            type="button"
            disabled={!activeTarget}
            onClick={() => emit(sym)}
            className={`touch-manipulation rounded-lg border active:opacity-90 disabled:pointer-events-none disabled:opacity-35 ${keySize}`}
            style={{
              borderColor: "var(--border)",
              background: "var(--surface-muted)",
              color: "var(--foreground)",
            }}
          >
            {sym}
          </button>
        ))}
      </div>

      {ROWS_LOWER.map((row, ri) => (
        <div
          key={ri}
          className="mb-1 flex flex-wrap justify-center gap-1"
          style={ri === 1 ? { paddingLeft: "0.5rem", paddingRight: "0.5rem" } : undefined}
        >
          {row.map((ch) => {
            const out = shift ? ch.toUpperCase() : ch;
            return (
              <button
                key={ch}
                type="button"
                disabled={!activeTarget}
                onClick={() => emit(out)}
                className={`touch-manipulation rounded-lg border active:opacity-90 disabled:pointer-events-none disabled:opacity-35 ${keySize}`}
                style={{
                  borderColor: "var(--border)",
                  background: "var(--surface-muted)",
                  color: "var(--foreground)",
                }}
              >
                {out}
              </button>
            );
          })}
        </div>
      ))}

      <div className="mt-2 flex flex-wrap justify-center gap-1">
        <button
          type="button"
          onClick={() => setShift((s) => !s)}
          className={`touch-manipulation flex min-h-[40px] min-w-[52px] items-center justify-center rounded-lg border px-2 active:opacity-90 ${largeKeys ? "min-h-[44px]" : ""}`}
          style={{
            borderColor: "var(--border)",
            background: shift ? "var(--accent)" : "var(--surface-muted)",
            color: shift ? "var(--accent-foreground)" : "var(--foreground)",
          }}
          aria-pressed={shift}
        >
          <ArrowBigUp size={largeKeys ? 22 : 20} strokeWidth={2} aria-hidden />
        </button>
        <button
          type="button"
          disabled={!activeTarget}
          onClick={() => emit(" ")}
          className={`touch-manipulation flex min-h-[40px] flex-1 items-center justify-center gap-1 rounded-lg border px-3 text-sm font-semibold active:opacity-90 disabled:pointer-events-none disabled:opacity-35 sm:max-w-[220px] ${largeKeys ? "min-h-[44px] text-base" : ""}`}
          style={{
            borderColor: "var(--border)",
            background: "var(--surface-muted)",
            color: "var(--foreground)",
          }}
        >
          <Space size={18} aria-hidden />
          Space
        </button>
        <button
          type="button"
          disabled={!activeTarget}
          onClick={() => emit("bksp")}
          className={`touch-manipulation flex min-h-[40px] min-w-[52px] items-center justify-center rounded-lg border active:opacity-90 disabled:pointer-events-none disabled:opacity-35 ${largeKeys ? "min-h-[44px]" : ""}`}
          style={{
            borderColor: "var(--border)",
            background: "var(--surface-muted)",
            color: "var(--foreground)",
          }}
          aria-label="Backspace"
        >
          <Delete size={largeKeys ? 22 : 20} strokeWidth={2} aria-hidden />
        </button>
      </div>
    </div>
  );
}
