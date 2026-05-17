"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import {
  ChevronDown,
  LogIn,
  LogOut,
  Settings,
  UserRound,
  Shield,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { describePermissionCount, hasPermission, normalizePermissions, PERMISSIONS } from "@/lib/permissions";
import { useLang } from "@/lib/i18n";

function initials(name: string | null | undefined, email: string | null | undefined) {
  if (name?.trim()) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }
  if (email) return email.slice(0, 2).toUpperCase();
  return "?";
}

function formatAccessLabel(permissionCount: number, lang: string) {
  if (lang === "ar") {
    return `${permissionCount} صلاحية`;
  }
  return describePermissionCount(permissionCount);
}

const btnBase =
  "inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border text-sm font-medium transition-all duration-150 hover:opacity-95 active:scale-95";

export function UserMenu() {
  const { data: session, status } = useSession();
  const { t, lang } = useLang();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  if (status === "loading") {
    return (
      <div
        className="h-9 w-[7rem] shrink-0 animate-pulse rounded-lg border"
        style={{ borderColor: "var(--border)", background: "var(--surface-muted)" }}
        aria-hidden
      />
    );
  }

  if (!session?.user) {
    return (
      <Link
        href="/login"
        className={`${btnBase} px-3`}
        style={{
          borderColor: "var(--border)",
          background: "var(--accent)",
          color: "var(--accent-foreground)",
        }}
      >
        <LogIn size={16} strokeWidth={2} aria-hidden className="shrink-0" />
        <span className="hidden sm:inline">{t.userMenu.signIn}</span>
      </Link>
    );
  }

  const user = session.user;
  const label = initials(user.name, user.email);
  const permissions = normalizePermissions(user.permissions ?? []);
  const canOpenSettings = hasPermission(permissions, PERMISSIONS.settingsStoreRead);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`${btnBase} max-w-[min(100vw-8rem,14rem)] ps-2 pe-2 sm:max-w-[15rem]`}
        style={{
          borderColor: "var(--border)",
          background: "var(--surface-muted)",
          color: "var(--foreground)",
        }}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold leading-none"
          style={{
            background: "color-mix(in srgb, var(--accent) 22%, var(--surface))",
            color: "var(--foreground)",
          }}
          aria-hidden
        >
          {label}
        </span>
        <span className="hidden min-w-0 flex-1 flex-col text-start sm:flex">
          <span className="truncate text-sm font-semibold leading-none">{user.name ?? t.userMenu.account}</span>
          <span className="mt-0.5 truncate text-[10px] leading-none" style={{ color: "var(--muted)" }}>
            {formatAccessLabel(permissions.length, lang)}
          </span>
        </span>
        <ChevronDown
          size={13}
          className={`hidden shrink-0 opacity-60 transition-transform duration-150 sm:block ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {open ? (
        <div
          role="menu"
          className="animate-scale-in absolute end-0 z-50 mt-1.5 w-[min(100vw-2rem,16rem)] rounded-xl border py-1 shadow-lg"
          style={{
            background: "var(--surface-elevated)",
            borderColor: "var(--border)",
            boxShadow: "var(--shadow-md)",
          }}
        >
          <div className="border-b px-3 py-2 sm:hidden" style={{ borderColor: "var(--border)" }}>
            <p className="truncate text-sm font-semibold">{user.name ?? t.userMenu.account}</p>
            <p className="truncate text-xs" style={{ color: "var(--muted)" }}>{user.email}</p>
          </div>
          <Link
            role="menuitem"
            href="/account"
            className="flex items-center gap-2 px-3 py-2 text-sm transition-all duration-100 hover:opacity-80"
            style={{ color: "var(--foreground)" }}
            onClick={() => setOpen(false)}
          >
            <UserRound size={15} strokeWidth={2} aria-hidden />
            {t.userMenu.profile}
          </Link>
          {canOpenSettings ? (
            <Link
              role="menuitem"
              href="/settings"
              className="flex items-center gap-2 px-3 py-2 text-sm transition-all duration-100 hover:opacity-80"
              style={{ color: "var(--foreground)" }}
              onClick={() => setOpen(false)}
            >
              <Settings size={15} strokeWidth={2} aria-hidden />
              {t.userMenu.settings}
            </Link>
          ) : null}
          <div className="my-1 h-px" style={{ background: "var(--border)" }} />
          <div className="flex items-center gap-2 px-3 py-1.5 text-xs" style={{ color: "var(--muted)" }}>
            <Shield size={13} strokeWidth={2} aria-hidden />
            <span>{formatAccessLabel(permissions.length, lang)}</span>
          </div>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm transition-all duration-100 hover:opacity-80"
            style={{ color: "var(--danger)" }}
            onClick={() => {
              setOpen(false);
              void signOut({ callbackUrl: "/login" });
            }}
          >
            <LogOut size={15} strokeWidth={2} aria-hidden />
            {t.userMenu.signOut}
          </button>
        </div>
      ) : null}
    </div>
  );
}
