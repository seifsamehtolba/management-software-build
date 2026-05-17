export const UI_APPEARANCE_KEY = "ui-appearance";

export type UiAppearance = "light" | "dark";

export function getStoredAppearance(): UiAppearance | null {
  if (typeof window === "undefined") return null;
  const v = localStorage.getItem(UI_APPEARANCE_KEY);
  if (v === "light" || v === "dark") return v;
  return null;
}

export function inferAppearanceFromPreset(themePreset: string): UiAppearance {
  return themePreset === "dark" ? "dark" : "light";
}

/** Maps store palette + light/dark preference to a `data-theme` value. */
export function effectiveThemePreset(appearance: UiAppearance, storePreset: string): string {
  if (appearance === "dark") return "dark";
  if (storePreset === "ocean" || storePreset === "forest" || storePreset === "default") return storePreset;
  return "default";
}

export function applyDocumentTheme(appearance: UiAppearance, storePreset: string, primaryColor: string) {
  const preset = effectiveThemePreset(appearance, storePreset);
  document.documentElement.setAttribute("data-theme", preset);
  document.documentElement.style.setProperty("--accent", primaryColor || "#2563eb");
}

export function persistAndApplyAppearance(
  appearance: UiAppearance,
  storePreset: string,
  primaryColor: string,
) {
  localStorage.setItem(UI_APPEARANCE_KEY, appearance);
  applyDocumentTheme(appearance, storePreset, primaryColor);
}
