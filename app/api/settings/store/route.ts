import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { PERMISSIONS } from "@/lib/permissions";
import { getStoreSettings, saveStoreSettings } from "@/lib/storeSettings";

const dashboardDefaultsSchema = z.object({
  showKpis: z.boolean(),
  showRecentSales: z.boolean(),
  showRecentRepairs: z.boolean(),
  showQuickActions: z.boolean(),
});

const loyaltySettingsSchema = z.object({
  enabled: z.boolean(),
  pointsPerEgp: z.number().min(0).max(100),
  redemptionValuePerPoint: z.number().min(0).max(10_000),
});

const patchSchema = z.object({
  storeName: z.string().trim().min(1).max(120).optional(),
  storeLogoUrl: z
    .string()
    .trim()
    .refine(
      (value) =>
        value === "" ||
        value.startsWith("data:image/") ||
        /^https?:\/\/.+/i.test(value),
      "Store logo must be an image data URL or an http/https URL",
    )
    .optional(),
  storePhone: z.string().trim().max(40).optional(),
  storeAddresses: z.array(z.string().trim().min(1).max(240)).max(12).optional(),
  storeWebsite: z.string().trim().max(200).optional(),
  storeInstagram: z
    .string()
    .trim()
    .regex(/^@?[A-Za-z0-9._]{1,30}$/, "Instagram username must contain only letters, numbers, dot, underscore")
    .or(z.literal(""))
    .optional(),
  themePreset: z.enum(["default", "ocean", "forest", "dark"]).optional(),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  dashboardDefaults: dashboardDefaultsSchema.optional(),
  loyaltySettings: loyaltySettingsSchema.optional(),
});

export async function GET() {
  const auth = await requireApiAnyPermission([PERMISSIONS.settingsStoreRead]);
  if (!auth.ok) return auth.response;
  const settings = await getStoreSettings();
  return NextResponse.json(settings);
}

export async function PATCH(req: NextRequest) {
  const auth = await requireApiAnyPermission([PERMISSIONS.settingsStoreUpdate]);
  if (!auth.ok) return auth.response;

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
  }

  await saveStoreSettings(parsed.data);
  const settings = await getStoreSettings();
  return NextResponse.json(settings);
}
