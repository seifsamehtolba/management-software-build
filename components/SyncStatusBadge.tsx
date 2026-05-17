"use client";

import { useEffect, useState } from "react";
import { CloudOff, Loader2, CloudCheck } from "lucide-react";
import { syncEngine } from "@/lib/syncEngine";

const shell =
  "inline-flex h-10 max-w-[10rem] shrink-0 items-center justify-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium sm:max-w-none sm:px-3";

export function SyncStatusBadge() {
  const [online, setOnline] = useState(
    typeof window === "undefined" ? true : window.navigator.onLine,
  );
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const updatePending = async () => {
      setPending(await syncEngine.getPendingCount());
    };

    const handleOnline = () => {
      setOnline(true);
      setSyncing(true);
      void syncEngine.flushQueue().finally(() => setSyncing(false));
    };

    const handleOffline = () => setOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    const interval = setInterval(() => {
      void updatePending();
    }, 5000);
    void updatePending();

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(interval);
    };
  }, []);

  const border = { borderColor: "var(--border)" };

  if (!online) {
    return (
      <span className={shell} style={{ ...border, background: "var(--surface-muted)", color: "var(--danger)" }}>
        <CloudOff size={14} strokeWidth={2} aria-hidden className="shrink-0" />
        <span className="truncate">
          Offline{pending > 0 ? ` · ${pending}` : ""}
        </span>
      </span>
    );
  }

  if (syncing) {
    return (
      <span className={shell} style={{ ...border, background: "var(--surface-muted)", color: "var(--warning)" }}>
        <Loader2 size={14} strokeWidth={2} aria-hidden className="shrink-0 animate-spin" />
        <span>Syncing</span>
      </span>
    );
  }

  return (
    <span className={shell} style={{ ...border, background: "var(--surface-muted)", color: "var(--success)" }}>
      <CloudCheck size={14} strokeWidth={2} aria-hidden className="shrink-0" />
      <span className="hidden sm:inline">Synced</span>
      <span className="sm:hidden">OK</span>
    </span>
  );
}
