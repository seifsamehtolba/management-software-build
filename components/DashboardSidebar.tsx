"use client";

import Link from "next/link";
import Image from "next/image";
import {
  LayoutDashboard,
  ShoppingCart,
  Boxes,
  Users,
  Wrench,
  Truck,
  Wallet,
  Settings,
  AlertCircle,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { parseResponseJson } from "@/lib/parseResponseJson";

const nav = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/pos", label: "POS", icon: ShoppingCart },
  { href: "/inventory", label: "Inventory", icon: Boxes },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/debts", label: "Debts", icon: AlertCircle },
  { href: "/repairs", label: "Repairs", icon: Wrench },
  { href: "/purchasing", label: "Purchasing", icon: Truck },
  { href: "/finance", label: "Finance", icon: Wallet },
  { href: "/settings", label: "Settings", icon: Settings },
] as const satisfies Array<{ href: string; label: string; icon: LucideIcon }>;

type StoreSettingsResponse = {
  storeName: string;
  storeLogoUrl: string;
};

export function DashboardSidebar() {
  const [settings, setSettings] = useState<StoreSettingsResponse>({
    storeName: "",
    storeLogoUrl: "",
  });

  useEffect(() => {
    const timer = setTimeout(async () => {
      const res = await fetch("/api/settings/store");
      if (!res.ok) return;
      const data = await parseResponseJson<StoreSettingsResponse>(res);
      if (!data) return;
      setSettings(data);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const nameInitials = (settings.storeName || "ST").slice(0, 2).toUpperCase();

  return (
    <aside className="w-64 border-r p-4" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
      <div className="mb-4 flex min-h-14 items-center justify-center gap-3">
        {settings.storeLogoUrl ? (
          <Image
            src={settings.storeLogoUrl}
            alt="Store logo"
            width={160}
            height={44}
            unoptimized
            className="h-11 w-auto max-w-[180px] object-contain"
          />
        ) : (
          <div
            className="flex h-9 w-9 items-center justify-center rounded text-xs font-bold"
            style={{ background: "var(--surface-muted)", color: "var(--foreground)" }}
          >
            {nameInitials}
          </div>
        )}
      </div>
      <nav className="flex flex-col gap-1">
        {nav.map((item) => {
          const Icon = item.icon;
          return (
          <Link key={item.href} href={item.href} className="flex items-center gap-2 rounded px-3 py-2 text-sm hover:bg-zinc-100">
            <Icon size={16} strokeWidth={2} aria-hidden />
            <span>{item.label}</span>
          </Link>
        )})}
      </nav>
    </aside>
  );
}
