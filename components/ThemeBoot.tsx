"use client";

import { useEffect } from "react";
import { parseResponseJson } from "@/lib/parseResponseJson";
import {
  applyDocumentTheme,
  getStoredAppearance,
  inferAppearanceFromPreset,
  persistAndApplyAppearance,
} from "@/lib/uiAppearance";

type SettingsPayload = {
  themePreset: "default" | "ocean" | "forest" | "dark";
  primaryColor: string;
};

export function ThemeBoot() {
  useEffect(() => {
    let mounted = true;

    const localTheme = localStorage.getItem("themePreset");
    const localAccent = localStorage.getItem("primaryColor");
    if (localTheme || localAccent) {
      const appearance =
        getStoredAppearance() ?? inferAppearanceFromPreset(localTheme ?? "default");
      applyDocumentTheme(appearance, localTheme ?? "default", localAccent ?? "#60a5fa");
    } else {
      applyDocumentTheme("dark", "dark", "#60a5fa");
    }

    void (async () => {
      try {
        const res = await fetch("/api/settings/store");
        if (!res.ok || !mounted) return;
        const data = await parseResponseJson<SettingsPayload>(res);
        if (!data || !mounted) return;
        localStorage.setItem("themePreset", data.themePreset);
        localStorage.setItem("primaryColor", data.primaryColor);
        const appearance =
          getStoredAppearance() ?? inferAppearanceFromPreset(data.themePreset);
        persistAndApplyAppearance(appearance, data.themePreset, data.primaryColor);
      } catch {
        /* ignore */
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  return null;
}
