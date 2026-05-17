"use client";

import { useEffect, useMemo, useState } from "react";
import { db, type SyncQueueItem } from "@/lib/localDb";
import { syncEngine } from "@/lib/syncEngine";
import Image from "next/image";
import { AppPage, Button, Card, EmptyState, Input, PageHeader, SectionTitle, Select, StatusBadge } from "@/components/ui/primitives";
import { errorMessageFromJson, parseResponseJson } from "@/lib/parseResponseJson";
import { useLang } from "@/lib/i18n";

export default function SettingsPage() {
  const { t } = useLang();
  const [activeTab, setActiveTab] = useState<"branding" | "sync" | "conflicts">("branding");
  const [items, setItems] = useState<SyncQueueItem[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [actionStatus, setActionStatus] = useState<string>("");
  const [previewById, setPreviewById] = useState<Record<number, { localPayload: Record<string, unknown> | null; serverRecord: Record<string, unknown> | null }>>({});
  const [storeName, setStoreName] = useState("");
  const [storeLogoUrl, setStoreLogoUrl] = useState("");
  const [storePhone, setStorePhone] = useState("");
  const [storeAddressesText, setStoreAddressesText] = useState("");
  const [storeWebsite, setStoreWebsite] = useState("");
  const [storeInstagram, setStoreInstagram] = useState("");
  const [themePreset, setThemePreset] = useState<"default" | "ocean" | "forest" | "dark">("dark");
  const [primaryColor, setPrimaryColor] = useState("#2563eb");
  const [dashboardDefaults, setDashboardDefaults] = useState({
    showKpis: true,
    showRecentSales: true,
    showRecentRepairs: true,
    showQuickActions: true,
  });
  const [loyaltySettings, setLoyaltySettings] = useState({
    enabled: true,
    pointsPerEgp: 0.01,
    redemptionValuePerPoint: 1,
  });
  const [savingStore, setSavingStore] = useState(false);

  const refresh = async () => {
    const rows = await db.sync_queue.orderBy("createdAt").reverse().toArray();
    setItems(rows);
  };

  useEffect(() => {
    const initialTimer = setTimeout(() => { void refresh(); }, 0);
    const interval = setInterval(() => { void refresh(); }, 3000);
    return () => { clearTimeout(initialTimer); clearInterval(interval); };
  }, []);

  useEffect(() => {
    const timer = setTimeout(async () => {
      const res = await fetch("/api/settings/store");
      if (!res.ok) return;
      const data = await parseResponseJson<{
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
      }>(res);
      if (!data) return;
      setStoreName(data.storeName);
      setStoreLogoUrl(data.storeLogoUrl);
      setStorePhone(data.storePhone ?? "");
      setStoreAddressesText((data.storeAddresses ?? []).join("\n"));
      setStoreWebsite(data.storeWebsite ?? "");
      setStoreInstagram(data.storeInstagram ?? "");
      setThemePreset(data.themePreset);
      setPrimaryColor(data.primaryColor);
      setDashboardDefaults(data.dashboardDefaults);
      setLoyaltySettings(data.loyaltySettings);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const pending   = useMemo(() => items.filter((item) => item.status === "pending" || item.status === "failed"), [items]);
  const conflicts = useMemo(() => items.filter((item) => item.status === "conflict"), [items]);
  const failed    = useMemo(() => items.filter((item) => item.status === "failed"), [items]);

  const forceSync = async () => {
    setSyncing(true);
    await syncEngine.flushQueue();
    await refresh();
    setSyncing(false);
  };

  const retryFailed = async () => {
    const failedRows = await db.sync_queue.where("status").equals("failed").toArray();
    await Promise.all(
      failedRows.map((row) => db.sync_queue.update(row.id!, { status: "pending", errorMessage: undefined })),
    );
    await forceSync();
  };

  const acceptServer = async (item: SyncQueueItem) => {
    if (!item.id) return;
    setActionStatus(`${t.settings.acceptServer}…`);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item),
      });
      const result = await parseResponseJson<{ status: string; serverRecord?: Record<string, unknown> }>(res);
      if (!result) { setActionStatus(`Failed to accept server state.`); return; }
      if (result.status === "conflict" && result.serverRecord) {
        const table = (db as unknown as Record<string, { update: (key: string, value: Record<string, unknown>) => Promise<unknown> } | undefined>)[item.tableName];
        await table?.update(item.recordId, { ...result.serverRecord, syncStatus: "synced" });
      }
      await db.sync_queue.update(item.id, { status: "synced", errorMessage: undefined });
      setActionStatus(`Server state accepted.`);
      await refresh();
    } catch { setActionStatus(`Failed to accept server state.`); }
  };

  const forceLocal = async (item: SyncQueueItem) => {
    if (!item.id) return;
    setActionStatus(`${t.settings.forceLocal}…`);
    try {
      const res = await fetch("/api/sync/force", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item),
      });
      const result = await parseResponseJson<{ status: string; message?: string }>(res);
      if (!result || result.status !== "synced") throw new Error(errorMessageFromJson(result, "Force local failed"));
      await db.sync_queue.update(item.id, { status: "synced", errorMessage: undefined });
      setActionStatus(`Local state forced.`);
      await refresh();
    } catch { setActionStatus(`Failed to force local state.`); }
  };

  const previewConflict = async (item: SyncQueueItem) => {
    if (!item.id) return;
    setActionStatus(`${t.settings.previewDiff}…`);
    try {
      const res = await fetch("/api/sync/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableName: item.tableName, recordId: item.recordId, payload: item.payload }),
      });
      const result = await parseResponseJson<{
        status: string;
        localPayload: Record<string, unknown> | null;
        serverRecord: Record<string, unknown> | null;
      }>(res);
      if (!result) { setActionStatus(`Failed to load conflict preview.`); return; }
      setPreviewById((prev) => ({
        ...prev,
        [item.id!]: { localPayload: result.localPayload, serverRecord: result.serverRecord },
      }));
      setActionStatus(`Conflict preview loaded.`);
    } catch { setActionStatus(`Failed to load conflict preview.`); }
  };

  const saveStoreSettings = async () => {
    setSavingStore(true);
    setActionStatus(t.settings.saving);
    try {
      const res = await fetch("/api/settings/store", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeName, storeLogoUrl, storePhone,
          storeAddresses: storeAddressesText.split("\n").map((l) => l.trim()).filter(Boolean),
          storeWebsite, storeInstagram, themePreset, primaryColor, dashboardDefaults, loyaltySettings,
        }),
      });
      if (!res.ok) {
        const payload = await parseResponseJson<{ message?: string }>(res);
        throw new Error(errorMessageFromJson(payload, "Save failed"));
      }
      localStorage.setItem("themePreset", themePreset);
      localStorage.setItem("primaryColor", primaryColor);
      document.documentElement.setAttribute("data-theme", themePreset);
      document.documentElement.style.setProperty("--accent", primaryColor);
      setActionStatus(t.actions.save + " ✓");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save store settings.";
      setActionStatus(message);
    } finally {
      setSavingStore(false);
    }
  };

  const onLogoFileChange = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setActionStatus("Please choose a valid image file."); return; }
    const reader = new FileReader();
    reader.onload = () => { setStoreLogoUrl(typeof reader.result === "string" ? reader.result : ""); };
    reader.readAsDataURL(file);
  };

  return (
    <AppPage>
      <PageHeader title={t.settings.title} subtitle={t.settings.subtitle} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Button variant={activeTab === "branding" ? "primary" : "secondary"} onClick={() => setActiveTab("branding")}>
          {t.settings.branding}
        </Button>
        <Button variant={activeTab === "sync" ? "primary" : "secondary"} onClick={() => setActiveTab("sync")}>
          {t.settings.syncHealth}
        </Button>
        <Button variant={activeTab === "conflicts" ? "primary" : "secondary"} onClick={() => setActiveTab("conflicts")}>
          {t.settings.conflictCenter}
        </Button>
      </div>

      {activeTab === "branding" ? (
        <Card className="mb-6">
          <SectionTitle title={t.settings.storeBrandingTitle} />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium">{t.settings.storeName}</label>
              <Input value={storeName} onChange={(e) => setStoreName(e.target.value)} />
              <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>{t.settings.storeNameHint}</p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">{t.settings.storeLogoUrl}</label>
              <Input value={storeLogoUrl} onChange={(e) => setStoreLogoUrl(e.target.value)} placeholder="https://..." />
              <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>{t.settings.storeLogoUrlHint}</p>
              <div className="mt-2 flex items-center gap-2">
                <input type="file" accept="image/*" onChange={(e) => onLogoFileChange(e.target.files?.[0] ?? null)} className="text-xs" />
                <span className="text-xs" style={{ color: "var(--muted)" }}>{t.settings.uploadLogo}</span>
              </div>
              {storeLogoUrl ? (
                <Image src={storeLogoUrl} alt="Logo preview" width={48} height={48} unoptimized className="mt-2 h-12 w-12 rounded-lg object-cover" />
              ) : null}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">{t.settings.storePhone}</label>
              <Input value={storePhone} onChange={(e) => setStorePhone(e.target.value)} placeholder="+20..." />
              <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>{t.settings.storePhoneHint}</p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">{t.settings.storeWebsite}</label>
              <Input value={storeWebsite} onChange={(e) => setStoreWebsite(e.target.value)} placeholder="https://yourstore.com" />
              <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>{t.settings.storeWebsiteHint}</p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">{t.settings.instagramUsername}</label>
              <Input value={storeInstagram} onChange={(e) => setStoreInstagram(e.target.value)} placeholder="buildtechnology1" />
              <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>{t.settings.instagramHint}</p>
            </div>
            <div className="md:col-span-2">
              <label className="mb-1.5 block text-sm font-medium">{t.settings.storeAddresses}</label>
              <textarea
                value={storeAddressesText}
                onChange={(e) => setStoreAddressesText(e.target.value)}
                className="app-input min-h-24"
                placeholder={t.settings.storeAddressesPlaceholder}
              />
              <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>{t.settings.storeAddressesHint}</p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">{t.settings.themePreset}</label>
              <Select value={themePreset} onChange={(e) => setThemePreset(e.target.value as "default" | "ocean" | "forest" | "dark")}>
                <option value="default">Default</option>
                <option value="ocean">Ocean</option>
                <option value="forest">Forest</option>
                <option value="dark">Dark</option>
              </Select>
              <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>{t.settings.themePresetHint}</p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">{t.settings.primaryColor}</label>
              <Input value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} placeholder="#2563eb" />
              <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>{t.settings.primaryColorHint}</p>
            </div>
          </div>

          <div className="mt-5 rounded-xl border p-4" style={{ background: "var(--surface-muted)", borderColor: "var(--border)" }}>
            <p className="mb-3 text-sm font-semibold">{t.settings.liveThemePreview}</p>
            <div className="flex flex-wrap items-center gap-3">
              <div className="h-8 w-8 rounded-lg border shadow-sm" style={{ background: primaryColor }} title={t.settings.primaryAccent} />
              <div className="rounded-lg border px-3 py-1.5 text-xs" style={{ background: "var(--surface)" }}>{t.settings.surface}</div>
              <div className="rounded-lg border px-3 py-1.5 text-xs" style={{ background: "var(--surface-muted)" }}>{t.settings.mutedSurface}</div>
              <button type="button" className="rounded-lg px-3 py-1.5 text-xs font-semibold" style={{ background: primaryColor, color: "#ffffff" }}>
                {t.settings.primaryButton}
              </button>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-2.5 text-sm md:grid-cols-2">
            {[
              { key: "showKpis", label: t.settings.showKpis },
              { key: "showRecentSales", label: t.settings.showRecentSales },
              { key: "showRecentRepairs", label: t.settings.showRecentRepairs },
              { key: "showQuickActions", label: t.settings.showQuickActions },
            ].map(({ key, label }) => (
              <label key={key} className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={dashboardDefaults[key as keyof typeof dashboardDefaults]}
                  onChange={(e) => setDashboardDefaults((prev) => ({ ...prev, [key]: e.target.checked }))}
                />
                {label}
              </label>
            ))}
          </div>

          <div className="mt-5 rounded-xl border p-4" style={{ background: "var(--surface-muted)", borderColor: "var(--border)" }}>
            <p className="mb-3 text-sm font-semibold">Loyalty settings</p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={loyaltySettings.enabled}
                  onChange={(e) => setLoyaltySettings((prev) => ({ ...prev, enabled: e.target.checked }))}
                />
                Enable loyalty program
              </label>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Points per EGP</label>
                <Input
                  type="number"
                  min="0"
                  step="0.001"
                  value={loyaltySettings.pointsPerEgp}
                  onChange={(e) => setLoyaltySettings((prev) => ({ ...prev, pointsPerEgp: Number(e.target.value || 0) }))}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">EGP value per point</label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={loyaltySettings.redemptionValuePerPoint}
                  onChange={(e) => setLoyaltySettings((prev) => ({ ...prev, redemptionValuePerPoint: Number(e.target.value || 0) }))}
                />
              </div>
            </div>
          </div>

          <Button
            type="button"
            onClick={() => { void saveStoreSettings(); }}
            disabled={savingStore}
            className="mt-5"
          >
            {savingStore ? t.settings.saving : t.settings.saveStoreSettings}
          </Button>
          {actionStatus ? <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>{actionStatus}</p> : null}
        </Card>
      ) : null}

      {activeTab === "sync" ? (
        <>
          <Card className="mb-4">
            <SectionTitle title={t.settings.syncOverview} />
            <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-3">
              <p className="rounded-lg border p-3">{t.settings.pendingFailed}: <StatusBadge tone="warning">{pending.length}</StatusBadge></p>
              <p className="rounded-lg border p-3">{t.settings.conflicts}: <StatusBadge tone="danger">{conflicts.length}</StatusBadge></p>
              <p className="rounded-lg border p-3">{t.settings.failed}: <StatusBadge tone="danger">{failed.length}</StatusBadge></p>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" onClick={forceSync} disabled={syncing}>
                {syncing ? t.settings.syncing : t.settings.forceSync}
              </Button>
              <Button type="button" onClick={retryFailed} disabled={syncing || failed.length === 0} variant="secondary">
                {t.settings.retryFailed}
              </Button>
            </div>
            {actionStatus ? <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>{actionStatus}</p> : null}
          </Card>
          <Card className="mb-4">
            <SectionTitle title={t.settings.failedItems} />
            {failed.length === 0 ? (
              <EmptyState title={t.settings.noFailedItems} />
            ) : (
              <ul className="space-y-2 text-sm">
                {failed.map((item) => (
                  <li key={item.id} className="rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
                    <p className="font-semibold">{item.tableName} - {item.operation} - {item.recordId}</p>
                    <p style={{ color: "var(--muted)" }}>{t.settings.attempts}: {item.attempts}</p>
                    <p style={{ color: "var(--danger)" }}>{item.errorMessage ?? t.settings.unknownError}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : null}

      {activeTab === "conflicts" ? (
        <Card>
          <SectionTitle title={t.settings.conflictItems} />
          {conflicts.length === 0 ? (
            <EmptyState title={t.settings.noConflicts} />
          ) : (
            <ul className="space-y-3 text-sm">
              {conflicts.map((item) => (
                <li key={item.id} className="rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
                  <p className="font-semibold">{item.tableName} - {item.operation} - {item.recordId}</p>
                  <p style={{ color: "var(--muted)" }}>{item.errorMessage ?? t.settings.manualReview}</p>
                  <div className="mt-2 flex gap-2">
                    <button type="button" onClick={() => { void previewConflict(item); }} className="app-btn app-btn-secondary text-xs">
                      {t.settings.previewDiff}
                    </button>
                    <button type="button" onClick={() => { void acceptServer(item); }} className="app-btn app-btn-secondary text-xs">
                      {t.settings.acceptServer}
                    </button>
                    <button type="button" onClick={() => { void forceLocal(item); }} className="app-btn app-btn-secondary text-xs">
                      {t.settings.forceLocal}
                    </button>
                  </div>
                  {item.id && previewById[item.id] ? (
                    <div className="mt-3 rounded-lg border p-3 text-xs" style={{ background: "var(--surface-muted)", borderColor: "var(--border)" }}>
                      {(() => {
                        const preview = previewById[item.id!];
                        const local = preview.localPayload ?? {};
                        const server = preview.serverRecord ?? {};
                        const keys = Array.from(new Set([...Object.keys(local), ...Object.keys(server)])).slice(0, 20);
                        return (
                          <ul className="space-y-1.5">
                            {keys.map((key) => (
                              <li key={`${item.id}-${key}`} className="grid grid-cols-1 gap-1 md:grid-cols-3">
                                <span className="font-semibold">{key}</span>
                                <span>{t.settings.local}: {JSON.stringify(local[key])}</span>
                                <span>{t.settings.server}: {JSON.stringify(server[key])}</span>
                              </li>
                            ))}
                          </ul>
                        );
                      })()}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </AppPage>
  );
}
