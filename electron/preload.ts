import { contextBridge, ipcRenderer } from "electron";

export type UpdateInfo = {
  version: string;
  releaseNotes?: string | null;
};

export type DownloadProgress = {
  percent: number;
  transferred: number;
  total: number;
};

contextBridge.exposeInMainWorld("electronApp", {
  platform: process.platform,

  // Listen for update events (returns unsubscribe fn)
  onUpdateChecking: (cb: () => void) => listen("update:checking", cb),
  onUpdateAvailable: (cb: (info: UpdateInfo) => void) => listen("update:available", cb),
  onUpdateNotAvailable: (cb: () => void) => listen("update:not-available", cb),
  onUpdateProgress: (cb: (p: DownloadProgress) => void) => listen("update:progress", cb),
  onUpdateDownloaded: (cb: (info: UpdateInfo) => void) => listen("update:downloaded", cb),
  onUpdateError: (cb: (e: { message: string }) => void) => listen("update:error", cb),

  // Trigger install + restart
  installUpdate: () => ipcRenderer.send("update:install-now"),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function listen(channel: string, cb: (payload: any) => void) {
  const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}
