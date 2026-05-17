import { prisma } from "@/lib/prisma";

export type StoreSettings = {
  storeName: string;
  storeLogoUrl: string;
  storePhone: string;
  storeAddresses: string[];
  storeWebsite: string;
  storeInstagram: string;
  themePreset: "default" | "ocean" | "forest" | "dark";
  primaryColor: string;
  dashboardDefaults: {
    showKpis: boolean;
    showRecentSales: boolean;
    showRecentRepairs: boolean;
    showQuickActions: boolean;
  };
  loyaltySettings: {
    enabled: boolean;
    pointsPerEgp: number;
    redemptionValuePerPoint: number;
  };
};

const defaultSettings: StoreSettings = {
  storeName: "",
  storeLogoUrl: "",
  storePhone: "",
  storeAddresses: [],
  storeWebsite: "",
  storeInstagram: "",
  themePreset: "dark",
  primaryColor: "#60a5fa",
  dashboardDefaults: {
    showKpis: true,
    showRecentSales: true,
    showRecentRepairs: true,
    showQuickActions: true,
  },
  loyaltySettings: {
    enabled: true,
    pointsPerEgp: 0.01,
    redemptionValuePerPoint: 1,
  },
};

function safeJsonParse<T>(value: string | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function getStoreSettings(): Promise<StoreSettings> {
  const rows = await prisma.setting.findMany({
    where: {
      key: {
        in: [
          "storeName",
          "storeLogoUrl",
          "storePhone",
          "storeAddresses",
          "storeWebsite",
          "storeInstagram",
          "themePreset",
          "primaryColor",
          "dashboardDefaults",
          "loyaltySettings",
        ],
      },
    },
  });
  const map = new Map(rows.map((row) => [row.key, row.value]));

  const themePreset = map.get("themePreset");
  const normalizedTheme = themePreset === "ocean" || themePreset === "forest" || themePreset === "dark" ? themePreset : "default";

  return {
    storeName: map.get("storeName") || defaultSettings.storeName,
    storeLogoUrl: map.get("storeLogoUrl") || defaultSettings.storeLogoUrl,
    storePhone: map.get("storePhone") || defaultSettings.storePhone,
    storeAddresses: safeJsonParse(map.get("storeAddresses"), defaultSettings.storeAddresses),
    storeWebsite: map.get("storeWebsite") || defaultSettings.storeWebsite,
    storeInstagram: map.get("storeInstagram") || defaultSettings.storeInstagram,
    themePreset: normalizedTheme,
    primaryColor: map.get("primaryColor") || defaultSettings.primaryColor,
    dashboardDefaults: safeJsonParse(map.get("dashboardDefaults"), defaultSettings.dashboardDefaults),
    loyaltySettings: safeJsonParse(map.get("loyaltySettings"), defaultSettings.loyaltySettings),
  };
}

export async function saveStoreSettings(partial: Partial<StoreSettings>) {
  const entries: Array<{ key: string; value: string }> = [];
  if (partial.storeName !== undefined) entries.push({ key: "storeName", value: partial.storeName });
  if (partial.storeLogoUrl !== undefined) entries.push({ key: "storeLogoUrl", value: partial.storeLogoUrl });
  if (partial.storePhone !== undefined) entries.push({ key: "storePhone", value: partial.storePhone });
  if (partial.storeAddresses !== undefined) entries.push({ key: "storeAddresses", value: JSON.stringify(partial.storeAddresses) });
  if (partial.storeWebsite !== undefined) entries.push({ key: "storeWebsite", value: partial.storeWebsite });
  if (partial.storeInstagram !== undefined) entries.push({ key: "storeInstagram", value: partial.storeInstagram });
  if (partial.themePreset !== undefined) entries.push({ key: "themePreset", value: partial.themePreset });
  if (partial.primaryColor !== undefined) entries.push({ key: "primaryColor", value: partial.primaryColor });
  if (partial.dashboardDefaults !== undefined) {
    entries.push({ key: "dashboardDefaults", value: JSON.stringify(partial.dashboardDefaults) });
  }
  if (partial.loyaltySettings !== undefined) {
    entries.push({ key: "loyaltySettings", value: JSON.stringify(partial.loyaltySettings) });
  }

  await Promise.all(
    entries.map((item) =>
      prisma.setting.upsert({
        where: { key: item.key },
        update: { value: item.value },
        create: { key: item.key, value: item.value },
      }),
    ),
  );
}
