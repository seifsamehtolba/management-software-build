"use client";

import { useEffect, useState } from "react";
import { Download, RefreshCw, X, CheckCircle, Loader2 } from "lucide-react";

type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available"; version: string }
  | { status: "downloading"; percent: number }
  | { status: "ready"; version: string }
  | { status: "error"; message: string };

export function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateState>({ status: "idle" });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const ea = window.electronApp;
    if (!ea) return; // not running in Electron

    const unsubs = [
      ea.onUpdateChecking(() => setUpdate({ status: "checking" })),
      ea.onUpdateAvailable((info) => {
        setUpdate({ status: "available", version: info.version });
        setDismissed(false);
      }),
      ea.onUpdateNotAvailable(() => setUpdate({ status: "idle" })),
      ea.onUpdateProgress((p) => setUpdate({ status: "downloading", percent: p.percent })),
      ea.onUpdateDownloaded((info) => {
        setUpdate({ status: "ready", version: info.version });
        setDismissed(false);
      }),
      ea.onUpdateError((e) => setUpdate({ status: "error", message: e.message })),
    ];

    return () => unsubs.forEach((fn) => fn());
  }, []);

  if (dismissed || update.status === "idle" || update.status === "checking") return null;

  if (update.status === "available") {
    return (
      <Banner color="#3b82f6" onDismiss={() => setDismissed(true)}>
        <Download size={18} />
        <span>
          <strong>تحديث {update.version} متاح</strong> — يتم التنزيل في الخلفية…
        </span>
      </Banner>
    );
  }

  if (update.status === "downloading") {
    return (
      <Banner color="#3b82f6" noDismiss>
        <Loader2 size={18} className="animate-spin" />
        <span>جاري تنزيل التحديث… {update.percent}%</span>
        <div className="flex-1 mx-4 h-1.5 rounded-full bg-white/30 overflow-hidden">
          <div
            className="h-full rounded-full bg-white transition-all duration-300"
            style={{ width: `${update.percent}%` }}
          />
        </div>
      </Banner>
    );
  }

  if (update.status === "ready") {
    return (
      <Banner color="#16a34a" onDismiss={() => setDismissed(true)}>
        <CheckCircle size={18} />
        <span>
          <strong>التحديث {update.version} جاهز للتثبيت!</strong>
        </span>
        <button
          onClick={() => window.electronApp?.installUpdate()}
          className="ms-auto flex items-center gap-1.5 rounded-xl bg-white/20 px-4 py-1.5 text-sm font-bold hover:bg-white/30 transition-colors"
        >
          <RefreshCw size={14} />
          إعادة تشغيل وتحديث
        </button>
      </Banner>
    );
  }

  if (update.status === "error") {
    return (
      <Banner color="#dc2626" onDismiss={() => setDismissed(true)}>
        <span>تعذّر التحقق من التحديثات — {update.message}</span>
      </Banner>
    );
  }

  return null;
}

function Banner({
  color,
  children,
  onDismiss,
  noDismiss,
}: {
  color: string;
  children: React.ReactNode;
  onDismiss?: () => void;
  noDismiss?: boolean;
}) {
  return (
    <div
      className="fixed top-0 inset-x-0 z-[9999] flex items-center gap-3 px-5 py-3 text-sm text-white shadow-lg"
      style={{ background: color }}
      dir="rtl"
    >
      {children}
      {!noDismiss && onDismiss && (
        <button
          onClick={onDismiss}
          className="ms-auto rounded-lg p-1 hover:bg-white/20 transition-colors"
          aria-label="إغلاق"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}
