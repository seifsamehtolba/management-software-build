"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { SyncStatusBadge } from "@/components/SyncStatusBadge";
import { UserMenu } from "@/components/UserMenu";
import { HelpPanel } from "@/components/HelpPanel";
import {
  Home,
  ShoppingCart,
  Boxes,
  Users,
  UserCog,
  Wrench,
  Truck,
  Wallet,
  ClipboardList,
  Settings,
  Receipt,
  FileText,
  ShieldCheck,
  Store,
  Moon,
  Sun,
  Languages,
  HelpCircle,
  Cpu,
  Vault,
  TrendingDown,
  Tag,
  BarChart2,
  MoreHorizontal,
  X,
  ChevronLeft,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { parseResponseJson } from "@/lib/parseResponseJson";
import { hasPermission, PERMISSIONS, normalizePermissions, type PermissionKey } from "@/lib/permissions";
import {
  getStoredAppearance,
  inferAppearanceFromPreset,
  persistAndApplyAppearance,
  type UiAppearance,
} from "@/lib/uiAppearance";
import { useLang } from "@/lib/i18n";

type NavKey =
  | "dashboard" | "pos" | "inventory" | "customers" | "repairs" | "purchasing"
  | "finance" | "payables" | "quotes" | "receipts" | "settings" | "team" | "hr" | "audit"
  | "builds" | "cashShifts" | "reorder" | "promotions" | "analytics";

type NavItemDef = {
  href: string;
  key: NavKey;
  icon: LucideIcon;
  color: string;
  requiredPermission?: PermissionKey;
};

type CategoryDef = {
  key: string;
  icon: LucideIcon;
  color: string;
  href?: string;
  items?: NavItemDef[];
};

const categories: CategoryDef[] = [
  { key: "home",      icon: Home,          color: "#60a5fa", href: "/" },
  {
    key: "sell",      icon: ShoppingCart,  color: "#22c55e",
    items: [
      { href: "/pos",      key: "pos",      icon: ShoppingCart, color: "#22c55e" },
      { href: "/quotes",   key: "quotes",   icon: FileText,     color: "#16a34a" },
      { href: "/receipts", key: "receipts", icon: Receipt,      color: "#15803d" },
    ],
  },
  {
    key: "stock",     icon: Boxes,         color: "#3b82f6",
    items: [
      { href: "/inventory",  key: "inventory",  icon: Boxes,        color: "#3b82f6" },
      { href: "/reorder",    key: "reorder",    icon: TrendingDown,  color: "#2563eb" },
      { href: "/purchasing", key: "purchasing", icon: Truck,         color: "#1d4ed8" },
    ],
  },
  { key: "customers", icon: Users,         color: "#a855f7", href: "/customers" },
  {
    key: "more",      icon: MoreHorizontal, color: "#64748b",
    items: [
      { href: "/repairs",     key: "repairs",    icon: Wrench,        color: "#f59e0b" },
      { href: "/builds",      key: "builds",     icon: Cpu,           color: "#f97316", requiredPermission: PERMISSIONS.buildsRead },
      { href: "/finance",     key: "finance",    icon: Wallet,        color: "#10b981", requiredPermission: PERMISSIONS.reportsFinanceRead },
      { href: "/cash-shifts", key: "cashShifts", icon: Vault,         color: "#059669" },
      { href: "/payables",    key: "payables",   icon: ClipboardList, color: "#14b8a6", requiredPermission: PERMISSIONS.financePayablesRead },
      { href: "/promotions",  key: "promotions", icon: Tag,           color: "#ec4899", requiredPermission: PERMISSIONS.promotionsRead },
      { href: "/analytics",   key: "analytics",  icon: BarChart2,     color: "#8b5cf6", requiredPermission: PERMISSIONS.reportsDashboardRead },
      { href: "/settings",    key: "settings",   icon: Settings,      color: "#94a3b8", requiredPermission: PERMISSIONS.settingsStoreRead },
      { href: "/users",       key: "team",       icon: UserCog,       color: "#94a3b8", requiredPermission: PERMISSIONS.usersRead },
      { href: "/hr",          key: "hr",         icon: UserCog,       color: "#94a3b8", requiredPermission: PERMISSIONS.hrRead },
      { href: "/audit",       key: "audit",      icon: ShieldCheck,   color: "#475569", requiredPermission: PERMISSIONS.auditRead },
    ],
  },
];

const catLabels: Record<string, { ar: string; en: string }> = {
  home:      { ar: "الرئيسية", en: "Home" },
  sell:      { ar: "بيع",      en: "Sell" },
  stock:     { ar: "مخزون",    en: "Stock" },
  customers: { ar: "عملاء",    en: "Customers" },
  more:      { ar: "المزيد",   en: "More" },
};

function getPageTitle(pathname: string, t: ReturnType<typeof useLang>["t"]): string {
  if (pathname === "/") return t.pages.dashboard;
  const parts = pathname.split("/").filter(Boolean);
  const first = parts[0] ?? "dashboard";
  const nav = t.nav as Record<string, string>;
  const map: Record<string, string> = {
    account: t.pages.account,
    customers: parts[1] ? t.pages.customer : t.pages.customers,
    repairs: parts[1] ? t.pages.repair : t.pages.repairs,
    purchasing: parts[1] ? t.pages.purchaseOrder : t.pages.purchasing,
    payables: t.pages.payables,
    users: t.pages.team,
    hr: t.pages.hr,
    audit: t.pages.audit,
    pos: t.pages.pos,
    inventory: t.pages.inventory,
    finance: t.pages.finance,
    quotes: t.pages.quotes,
    receipts: t.pages.receipts,
    settings: t.pages.settings,
    builds: nav.builds ?? "Builds",
    "cash-shifts": nav.cashShifts ?? "Cash Shifts",
    reorder: nav.reorder ?? "Reorder",
    promotions: nav.promotions ?? "Promotions",
    analytics: nav.analytics ?? "Analytics",
  };
  return map[first] ?? (first.charAt(0).toUpperCase() + first.slice(1));
}

const controlBtn =
  "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-all duration-150 hover:opacity-90 active:scale-95";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { lang, t, setLang } = useLang();

  const permissions = useMemo(
    () => normalizePermissions(session?.user?.permissions ?? []),
    [session?.user?.permissions],
  );

  const isAuthPage = pathname.startsWith("/login");
  const title = useMemo(() => getPageTitle(pathname, t), [pathname, t]);

  const [branding, setBranding] = useState({ storeName: "", storeLogoUrl: "" });
  const [appearance, setAppearance] = useState<UiAppearance | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [drawerCat, setDrawerCat] = useState<string | null>(null);

  useEffect(() => {
    const initial = getStoredAppearance() ?? inferAppearanceFromPreset(localStorage.getItem("themePreset") ?? "default");
    setAppearance(initial);
  }, []);

  useEffect(() => {
    if (isAuthPage) return;
    const timer = setTimeout(async () => {
      const res = await fetch("/api/settings/store");
      if (!res.ok) return;
      const data = await parseResponseJson<{ storeName: string; storeLogoUrl: string }>(res);
      if (data) setBranding({ storeName: data.storeName, storeLogoUrl: data.storeLogoUrl });
    }, 0);
    return () => clearTimeout(timer);
  }, [isAuthPage]);

  // Lock scroll when drawer open
  useEffect(() => {
    document.body.style.overflow = drawerCat ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [drawerCat]);

  // Close drawer on navigation
  useEffect(() => { setDrawerCat(null); }, [pathname]);

  const toggleAppearance = () => {
    const theme = localStorage.getItem("themePreset") ?? "default";
    const accent = localStorage.getItem("primaryColor") ?? "#60a5fa";
    const current = getStoredAppearance() ?? inferAppearanceFromPreset(theme);
    const next: UiAppearance = current === "dark" ? "light" : "dark";
    persistAndApplyAppearance(next, theme, accent);
    setAppearance(next);
  };

  const toggleLang = () => setLang(lang === "ar" ? "en" : "ar");

  if (isAuthPage) return <>{children}</>;

  const activeKey = (() => {
    if (pathname === "/") return "home";
    if (["/pos", "/quotes", "/receipts"].some((p) => pathname.startsWith(p))) return "sell";
    if (["/inventory", "/reorder", "/purchasing"].some((p) => pathname.startsWith(p))) return "stock";
    if (pathname.startsWith("/customers")) return "customers";
    return "more";
  })();

  const drawerCategory = drawerCat ? categories.find((c) => c.key === drawerCat) : null;
  const drawerItems = drawerCategory?.items?.filter(
    (item) => !item.requiredPermission || hasPermission(permissions, item.requiredPermission),
  ) ?? [];

  const navKeys = t.nav as Record<string, string>;
  const navDescs = t.navDesc as Record<string, string>;

  return (
    <div className="min-h-screen pb-24" style={{ background: "var(--background)" }}>

      {/* ── Header ── */}
      <header
        className="sticky top-0 z-30 border-b backdrop-blur-xl"
        style={{
          background: "color-mix(in srgb, var(--surface) 94%, transparent)",
          borderColor: "var(--border)",
          boxShadow: "0 1px 16px rgba(0,0,0,0.07)",
        }}
      >
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="group flex min-w-0 flex-1 items-center gap-3">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl border-2 shadow-sm transition-all group-hover:opacity-90"
              style={{
                borderColor: "color-mix(in srgb, var(--accent) 35%, var(--border))",
                background: "color-mix(in srgb, var(--accent) 12%, var(--surface))",
              }}
            >
              {branding.storeLogoUrl ? (
                <Image src={branding.storeLogoUrl} alt="" width={44} height={44} unoptimized className="h-full w-full object-contain p-1" />
              ) : (
                <Store size={20} strokeWidth={2} style={{ color: "var(--accent)" }} aria-hidden />
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-base font-bold leading-tight">
                {branding.storeName || (lang === "ar" ? "متجر الأجهزة" : "Hardware Store")}
              </p>
              <p className="mt-0.5 truncate text-xs leading-tight" style={{ color: "var(--muted)" }}>{title}</p>
            </div>
          </Link>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={toggleLang}
              className={controlBtn}
              style={{
                borderColor: "var(--border)",
                background: "var(--surface-muted)",
                color: "var(--foreground)",
                fontSize: "0.72rem",
                fontWeight: 700,
                width: "auto",
                paddingInline: "0.55rem",
              }}
              aria-label={lang === "ar" ? "Switch to English" : "التبديل للعربية"}
            >
              <Languages size={15} strokeWidth={2} aria-hidden className="shrink-0" />
              <span className="ms-1">{lang === "ar" ? "EN" : "عر"}</span>
            </button>

            <button
              type="button"
              onClick={toggleAppearance}
              className={controlBtn}
              style={{ borderColor: "var(--border)", background: "var(--surface-muted)", color: "var(--foreground)" }}
              aria-label={appearance === "light" ? t.theme.switchToDark : t.theme.switchToLight}
            >
              {appearance === "light"
                ? <Moon size={17} strokeWidth={2} aria-hidden />
                : <Sun size={17} strokeWidth={2} aria-hidden />}
            </button>

            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className={controlBtn}
              style={{
                borderColor: "color-mix(in srgb, var(--accent) 40%, var(--border))",
                background: "color-mix(in srgb, var(--accent) 12%, var(--surface-muted))",
                color: "var(--accent)",
              }}
              aria-label={lang === "ar" ? "دليل الاستخدام" : "Help guide"}
            >
              <HelpCircle size={17} strokeWidth={2} aria-hidden />
            </button>

            <SyncStatusBadge />
            <UserMenu />
          </div>
        </div>
      </header>

      {/* ── Page content ── */}
      <main className="animate-fade-in">{children}</main>

      {/* ── Bottom navigation bar ── */}
      <nav
        className="fixed bottom-0 inset-x-0 z-40 border-t"
        style={{
          background: "color-mix(in srgb, var(--surface) 97%, transparent)",
          borderColor: "var(--border)",
          backdropFilter: "blur(24px)",
          boxShadow: "0 -4px 28px rgba(0,0,0,0.10)",
        }}
        aria-label={lang === "ar" ? "القائمة الرئيسية" : "Main navigation"}
      >
        <div className="mx-auto flex max-w-lg items-stretch">
          {categories.map((cat) => {
            const isActive = activeKey === cat.key;
            const isOpen = drawerCat === cat.key;
            const label = catLabels[cat.key]?.[lang === "ar" ? "ar" : "en"] ?? cat.key;
            const Icon = cat.icon;

            const btnContent = (
              <span className="relative flex flex-col items-center gap-0.5 py-2.5 px-1 w-full">
                {/* Active indicator bar */}
                <span
                  className="absolute -top-px h-0.5 w-8 rounded-full transition-all duration-300"
                  style={{ background: isActive || isOpen ? cat.color : "transparent" }}
                />
                {/* Icon bubble */}
                <span
                  className="flex h-11 w-11 items-center justify-center rounded-2xl transition-all duration-200"
                  style={{
                    background: isActive || isOpen ? `${cat.color}1f` : "transparent",
                    transform: isOpen ? "scale(0.92)" : "scale(1)",
                  }}
                >
                  <Icon
                    size={23}
                    strokeWidth={isActive || isOpen ? 2.5 : 1.7}
                    style={{ color: isActive || isOpen ? cat.color : "var(--muted)" }}
                    aria-hidden
                  />
                </span>
                {/* Label */}
                <span
                  className="text-[11px] font-bold leading-none"
                  style={{ color: isActive || isOpen ? cat.color : "var(--muted)" }}
                >
                  {label}
                </span>
              </span>
            );

            if (cat.href) {
              return (
                <Link key={cat.key} href={cat.href} className="relative flex flex-1 flex-col items-center transition-opacity active:opacity-60">
                  {btnContent}
                </Link>
              );
            }

            return (
              <button
                key={cat.key}
                type="button"
                onClick={() => setDrawerCat(isOpen ? null : cat.key)}
                className="relative flex flex-1 flex-col items-center transition-opacity active:opacity-60"
              >
                {btnContent}
              </button>
            );
          })}
        </div>
      </nav>

      {/* ── Drawer ── */}
      {drawerCat && drawerCategory && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end"
          onClick={() => setDrawerCat(null)}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0"
            style={{ background: "rgba(0,0,0,0.50)", backdropFilter: "blur(6px)" }}
          />

          {/* Panel */}
          <div
            className="animate-drawer-up relative w-full rounded-t-[28px] border-t"
            style={{
              background: "var(--surface)",
              borderColor: "var(--border)",
              boxShadow: "0 -12px 48px rgba(0,0,0,0.22)",
              maxHeight: "80vh",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="h-1.5 w-12 rounded-full" style={{ background: "var(--border)" }} />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between border-b px-5 py-3.5" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-center gap-3">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-2xl"
                  style={{ background: `${drawerCategory.color}22` }}
                >
                  {(() => { const Icon = drawerCategory.icon; return <Icon size={20} strokeWidth={2} style={{ color: drawerCategory.color }} aria-hidden />; })()}
                </div>
                <p className="text-xl font-black">
                  {catLabels[drawerCat]?.[lang === "ar" ? "ar" : "en"]}
                </p>
              </div>
              <button
                onClick={() => setDrawerCat(null)}
                className="flex h-9 w-9 items-center justify-center rounded-xl border transition-all hover:opacity-70 active:scale-95"
                style={{ borderColor: "var(--border)", background: "var(--surface-muted)", color: "var(--muted)" }}
                aria-label={lang === "ar" ? "إغلاق" : "Close"}
              >
                <X size={18} aria-hidden />
              </button>
            </div>

            {/* Items */}
            <div className="overflow-y-auto p-4" style={{ maxHeight: "calc(80vh - 110px)" }}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {drawerItems.map((item) => {
                  const Icon = item.icon;
                  const isCurrent = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
                  const label = navKeys[item.key] ?? item.key;
                  const desc = navDescs[item.key] ?? "";

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="flex items-center gap-4 rounded-2xl border p-4 transition-all active:scale-[0.97] hover:shadow-sm"
                      style={{
                        borderColor: isCurrent ? item.color : "var(--border)",
                        background: isCurrent ? `${item.color}14` : "var(--surface-muted)",
                        boxShadow: isCurrent ? `0 0 0 2px ${item.color}40` : undefined,
                      }}
                    >
                      {/* Icon */}
                      <div
                        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl"
                        style={{ background: `${item.color}20` }}
                      >
                        <Icon size={28} strokeWidth={1.8} style={{ color: item.color }} aria-hidden />
                      </div>

                      {/* Text */}
                      <div className="min-w-0 flex-1">
                        <p
                          className="font-bold leading-tight"
                          style={{ fontSize: "15px", color: isCurrent ? item.color : "var(--foreground)" }}
                        >
                          {label}
                        </p>
                        {desc && (
                          <p className="mt-1 text-xs leading-snug line-clamp-2" style={{ color: "var(--muted)" }}>
                            {desc}
                          </p>
                        )}
                      </div>

                      {/* Arrow */}
                      {lang === "ar"
                        ? <ChevronLeft size={18} strokeWidth={2} style={{ color: "var(--muted)", flexShrink: 0 }} aria-hidden />
                        : <ChevronRight size={18} strokeWidth={2} style={{ color: "var(--muted)", flexShrink: 0 }} aria-hidden />}
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      <HelpPanel open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
