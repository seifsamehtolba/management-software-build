"use client";

import { useEffect, useRef } from "react";
import {
  X,
  LayoutDashboard,
  ShoppingCart,
  Boxes,
  Users,
  AlertCircle,
  Wrench,
  Truck,
  Wallet,
  ClipboardList,
  FileText,
  Receipt,
  Settings,
  UserCog,
  ShieldCheck,
  Lightbulb,
  Cpu,
  Vault,
  TrendingDown,
  Tag,
  BarChart2,
  type LucideIcon,
} from "lucide-react";
import { useLang } from "@/lib/i18n";

type NavKey =
  | "dashboard"
  | "pos"
  | "inventory"
  | "customers"
  | "debts"
  | "repairs"
  | "purchasing"
  | "finance"
  | "payables"
  | "quotes"
  | "receipts"
  | "settings"
  | "team"
  | "hr"
  | "audit"
  | "builds"
  | "cashShifts"
  | "reorder"
  | "promotions"
  | "analytics";

const sections: Array<{ key: NavKey; icon: LucideIcon; guideKey: string; tipKey?: string }> = [
  { key: "dashboard",  icon: LayoutDashboard, guideKey: "dashboardGuide",  tipKey: "tipDashboard" },
  { key: "pos",        icon: ShoppingCart,    guideKey: "posGuide",         tipKey: "tipPos" },
  { key: "inventory",  icon: Boxes,           guideKey: "inventoryGuide",   tipKey: "tipInventory" },
  { key: "customers",  icon: Users,           guideKey: "customersGuide",   tipKey: "tipCustomers" },
  { key: "debts",      icon: AlertCircle,     guideKey: "debtsGuide" },
  { key: "repairs",    icon: Wrench,          guideKey: "repairsGuide" },
  { key: "purchasing", icon: Truck,           guideKey: "purchasingGuide" },
  { key: "finance",    icon: Wallet,          guideKey: "financeGuide" },
  { key: "payables",   icon: ClipboardList,   guideKey: "payablesGuide" },
  { key: "quotes",     icon: FileText,        guideKey: "quotesGuide",      tipKey: "tipQuotes" },
  { key: "receipts",   icon: Receipt,         guideKey: "receiptsGuide" },
  { key: "settings",   icon: Settings,        guideKey: "settingsGuide" },
  { key: "team",       icon: UserCog,         guideKey: "teamGuide" },
  { key: "hr",         icon: UserCog,         guideKey: "hrGuide" },
  { key: "audit",      icon: ShieldCheck,     guideKey: "auditGuide" },
  { key: "builds",     icon: Cpu,          guideKey: "buildsGuide" },
  { key: "cashShifts", icon: Vault,        guideKey: "cashShiftsGuide" },
  { key: "reorder",    icon: TrendingDown, guideKey: "reorderGuide" },
  { key: "promotions", icon: Tag,          guideKey: "promotionsGuide" },
  { key: "analytics",  icon: BarChart2,    guideKey: "analyticsGuide" },
];

export function HelpPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, lang } = useLang();
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Trap scroll behind overlay
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!open) return null;

  const helpT = t.help as Record<string, string>;
  const navT = t.nav as Record<string, string>;
  const navDescT = t.navDesc as Record<string, string>;

  return (
    <div
      className="fixed inset-0 z-50 flex"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Slide-in panel */}
      <div
        ref={panelRef}
        className="ms-auto flex h-full w-full max-w-lg flex-col overflow-hidden"
        style={{
          background: "var(--surface)",
          boxShadow: lang === "ar" ? "4px 0 32px rgba(0,0,0,0.18)" : "-4px 0 32px rgba(0,0,0,0.18)",
          animation: "slideInPanel 220ms cubic-bezier(0.22,1,0.36,1)",
        }}
        dir={lang === "ar" ? "rtl" : "ltr"}
      >
        {/* Header */}
        <div
          className="flex shrink-0 items-center justify-between gap-3 border-b px-5 py-4"
          style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--accent) 8%, var(--surface))" }}
        >
          <div>
            <h2 className="text-base font-bold" style={{ color: "var(--foreground)" }}>
              {helpT.title ?? "دليل الاستخدام"}
            </h2>
            <p className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>
              {helpT.subtitle ?? "شرح مفصّل لكل قسم"}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label={helpT.close}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-all hover:opacity-80 active:scale-95"
            style={{ borderColor: "var(--border)", background: "var(--surface-muted)", color: "var(--foreground)" }}
          >
            <X size={16} strokeWidth={2} aria-hidden />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-5">
            {sections.map(({ key, icon: Icon, guideKey, tipKey }) => {
              const guide: string = helpT[guideKey] ?? "";
              const tip: string | undefined = tipKey ? helpT[tipKey] : undefined;
              const lines = guide.split("\n").filter(Boolean);

              return (
                <div
                  key={key}
                  className="rounded-xl border"
                  style={{ borderColor: "var(--border)", background: "var(--surface-muted)" }}
                >
                  {/* Section header */}
                  <div
                    className="flex items-center gap-2.5 rounded-t-xl border-b px-4 py-3"
                    style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--accent) 7%, var(--surface-muted))" }}
                  >
                    <div
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                      style={{ background: "color-mix(in srgb, var(--accent) 15%, transparent)", color: "var(--accent)" }}
                    >
                      <Icon size={16} strokeWidth={2} aria-hidden />
                    </div>
                    <div>
                      <p className="text-sm font-bold" style={{ color: "var(--foreground)" }}>
                        {navT[key] ?? key}
                      </p>
                      <p className="text-[11px]" style={{ color: "var(--muted)" }}>
                        {navDescT[key] ?? ""}
                      </p>
                    </div>
                  </div>

                  {/* Guide lines */}
                  <div className="px-4 py-3">
                    <ul className="flex flex-col gap-1.5">
                      {lines.map((line, i) => {
                        const isBullet = line.startsWith("•");
                        const isNumbered = /^\d+\./.test(line);
                        return (
                          <li
                            key={i}
                            className="flex items-start gap-2 text-[13px] leading-snug"
                            style={{ color: "var(--foreground)" }}
                          >
                            {(isBullet || isNumbered) ? (
                              <span
                                className="mt-0.5 shrink-0 text-[11px] font-bold"
                                style={{ color: "var(--accent)", minWidth: "1rem" }}
                              >
                                {isBullet ? "•" : line.match(/^\d+/)?.[0] + "."}
                              </span>
                            ) : null}
                            <span>{isBullet ? line.slice(1).trim() : isNumbered ? line.replace(/^\d+\.\s*/, "") : line}</span>
                          </li>
                        );
                      })}
                    </ul>

                    {tip && (
                      <div
                        className="mt-3 flex items-start gap-2 rounded-lg px-3 py-2"
                        style={{ background: "color-mix(in srgb, var(--accent) 10%, transparent)" }}
                      >
                        <Lightbulb size={14} strokeWidth={2} className="mt-0.5 shrink-0" style={{ color: "var(--accent)" }} aria-hidden />
                        <p className="text-[12px]" style={{ color: "var(--foreground)" }}>
                          <span className="font-semibold" style={{ color: "var(--accent)" }}>{helpT.tip}: </span>
                          {tip}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes slideInPanel {
          from { transform: translateX(var(--panel-slide-from, 100%)); opacity: 0.6; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
