import { app, BrowserWindow, shell, ipcMain } from "electron";
import { join, resolve } from "path";
import { existsSync, mkdirSync } from "fs";
import { spawn, ChildProcess } from "child_process";
import getPort from "get-port";
import { autoUpdater } from "electron-updater";
// Generated at build time by scripts/bake-update-token.mjs — gitignored
let GH_READ_TOKEN = "";
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  GH_READ_TOKEN = (require("./update-token") as { GH_READ_TOKEN: string }).GH_READ_TOKEN ?? "";
} catch { /* not present in dev */ }

let win: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
let serverPort = 3000;

const isDev = !app.isPackaged;

// ── Auto-updater setup ───────────────────────────────────────────────────────

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // Required for private GitHub repos: read-only token baked in at build time
  const readToken = GH_READ_TOKEN || process.env.GH_READ_TOKEN;
  if (readToken) {
    autoUpdater.requestHeaders = { Authorization: `token ${readToken}` };
  }

  autoUpdater.on("checking-for-update", () => {
    sendToWindow("update:checking");
  });

  autoUpdater.on("update-available", (info) => {
    sendToWindow("update:available", {
      version: info.version,
      releaseNotes: info.releaseNotes ?? null,
    });
  });

  autoUpdater.on("update-not-available", () => {
    sendToWindow("update:not-available");
  });

  autoUpdater.on("download-progress", (progress) => {
    sendToWindow("update:progress", {
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    sendToWindow("update:downloaded", { version: info.version });
  });

  autoUpdater.on("error", (err) => {
    sendToWindow("update:error", { message: err.message });
  });

  // IPC: renderer asks to install now
  ipcMain.on("update:install-now", () => {
    autoUpdater.quitAndInstall(false, true);
  });

  // Check immediately, then every 4 hours
  if (!isDev) {
    autoUpdater.checkForUpdates().catch(console.error);
    setInterval(() => {
      autoUpdater.checkForUpdates().catch(console.error);
    }, 4 * 60 * 60 * 1000);
  }
}

function sendToWindow(channel: string, payload?: unknown) {
  win?.webContents?.send(channel, payload);
}

// ── Next.js server ───────────────────────────────────────────────────────────

function getDbPath(): string {
  const dataDir = app.getPath("userData");
  mkdirSync(dataDir, { recursive: true });
  return join(dataDir, "database.db");
}

function getServerRoot(): string {
  if (isDev) return resolve(__dirname, "..");
  return resolve(process.resourcesPath, "server");
}

async function startNextServer(): Promise<void> {
  serverPort = await getPort({ port: [3000, 3001, 3002, 3003, 3004, 3005] });

  const serverRoot = getServerRoot();
  const serverScript = join(serverRoot, "server.js");

  if (!existsSync(serverScript) && !isDev) {
    throw new Error(`Next.js server not found at ${serverScript}`);
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(serverPort),
    HOSTNAME: "127.0.0.1",
    DATABASE_URL: `file:${getDbPath()}`,
    NEXTAUTH_URL: `http://127.0.0.1:${serverPort}`,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ?? "electron-local-secret-change-me",
    NODE_ENV: "production" as const,
  };

  if (isDev) {
    console.log(`[electron] Dev mode — expecting Next.js at http://127.0.0.1:${serverPort}`);
    serverPort = 3000;
    return;
  }

  serverProcess = spawn(process.execPath, [serverScript], {
    env,
    cwd: serverRoot,
    stdio: "pipe",
  });

  serverProcess!.stdout?.on("data", (d: Buffer) => process.stdout.write(d));
  serverProcess!.stderr?.on("data", (d: Buffer) => process.stderr.write(d));

  await waitForServer(`http://127.0.0.1:${serverPort}/api/setup`, 30_000);
}

function waitForServer(url: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      fetch(url)
        .then(() => resolve())
        .catch(() => {
          if (Date.now() > deadline) {
            reject(new Error(`Server did not start in time (${url})`));
          } else {
            setTimeout(check, 500);
          }
        });
    };
    check();
  });
}

// ── Window ───────────────────────────────────────────────────────────────────

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "إدارة المتجر",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset" } : {}),
  });

  win.loadURL(`http://127.0.0.1:${serverPort}`);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith("http://127.0.0.1")) shell.openExternal(url);
    return { action: "deny" };
  });

  win.on("closed", () => { win = null; });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  try {
    await startNextServer();
    createWindow();
    setupAutoUpdater();
  } catch (err) {
    console.error("[electron] Failed to start:", err);
    app.quit();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  serverProcess?.kill();
});
