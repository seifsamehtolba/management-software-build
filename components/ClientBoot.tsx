"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { seedLocalDB } from "@/lib/seedLocalDb";
import { syncEngine } from "@/lib/syncEngine";

export function ClientBoot() {
  const { status } = useSession();

  useEffect(() => {
    syncEngine.startWatcher();

    if (status !== "authenticated") return;

    const lastSeedAt = localStorage.getItem("lastSeedAt");
    const stale = !lastSeedAt || Date.now() - new Date(lastSeedAt).getTime() > 24 * 60 * 60 * 1000;
    if (stale && navigator.onLine) {
      void seedLocalDB();
    }
  }, [status]);

  return null;
}
