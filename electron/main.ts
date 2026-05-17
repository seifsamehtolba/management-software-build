import { app, BrowserWindow, shell, ipcMain, dialog } from "electron";
import { join, resolve } from "path";
import { existsSync, mkdirSync, createWriteStream, WriteStream } from "fs";
import { spawn, ChildProcess } from "child_process";
import { createServer } from "net";
// electron-updater is lazy-loaded inside setupAutoUpdater() to prevent
// its internal electron-log from writing to stdout at import time (causes EPIPE).

// ── Port finder ───────────────────────────────────────────────────────────────

function findFreePort(preferred: number[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryPort = (ports: number[]) => {
      if (ports.length === 0) { reject(new Error("No free port found")); return; }
      const [port, ...rest] = ports;
      const srv = createServer();
      srv.listen(port, "127.0.0.1", () => { srv.close(() => resolve(port)); });
      srv.on("error", () => tryPort(rest));
    };
    tryPort(preferred);
  });
}

// ── Logger ────────────────────────────────────────────────────────────────────

let logStream: WriteStream | null = null;
const logBuffer: string[] = [];

function initLogger() {
  const logDir = app.getPath("userData");
  mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, "app.log");
  logStream = createWriteStream(logPath, { flags: "a" });
  // Flush anything logged before the file was ready
  for (const line of logBuffer) logStream.write(line);
  logBuffer.length = 0;
}

function log(...args: unknown[]) {
  const line = `[${new Date().toISOString()}] ${args.join(" ")}\n`;
  if (logStream) {
    logStream.write(line);
  } else {
    logBuffer.push(line);
  }
}

// ── Read-only update token ────────────────────────────────────────────────────

let GH_READ_TOKEN = "";
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  GH_READ_TOKEN = (require("./update-token") as { GH_READ_TOKEN: string }).GH_READ_TOKEN ?? "";
} catch { /* not generated in dev */ }

// ── State ─────────────────────────────────────────────────────────────────────

let win: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
let serverPort = 3000;

const isDev = !app.isPackaged;

// ── Auto-updater ──────────────────────────────────────────────────────────────

function setupAutoUpdater() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { autoUpdater } = require("electron-updater") as typeof import("electron-updater");
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  const readToken = GH_READ_TOKEN || process.env.GH_READ_TOKEN;
  if (readToken) autoUpdater.requestHeaders = { Authorization: `token ${readToken}` };

  autoUpdater.on("checking-for-update", () => sendToWindow("update:checking"));
  autoUpdater.on("update-available", (info) =>
    sendToWindow("update:available", { version: info.version, releaseNotes: info.releaseNotes ?? null }));
  autoUpdater.on("update-not-available", () => sendToWindow("update:not-available"));
  autoUpdater.on("download-progress", (p) =>
    sendToWindow("update:progress", { percent: Math.round(p.percent), transferred: p.transferred, total: p.total }));
  autoUpdater.on("update-downloaded", (info) =>
    sendToWindow("update:downloaded", { version: info.version }));
  autoUpdater.on("error", (err) => {
    log("[updater] error:", err.message);
    sendToWindow("update:error", { message: err.message });
  });

  ipcMain.on("update:install-now", () => autoUpdater.quitAndInstall(false, true));

  if (!isDev) {
    autoUpdater.checkForUpdates().catch((e: Error) => log("[updater] check failed:", e.message));
    setInterval(() => {
      autoUpdater.checkForUpdates().catch((e: Error) => log("[updater] check failed:", e.message));
    }, 4 * 60 * 60 * 1000);
  }
}

function sendToWindow(channel: string, payload?: unknown) {
  win?.webContents?.send(channel, payload);
}

// ── Next.js server ────────────────────────────────────────────────────────────

function getDbPath(): string {
  const dataDir = app.getPath("userData");
  mkdirSync(dataDir, { recursive: true });
  // Use forward slashes for the SQLite file: URI (works on all platforms)
  return dataDir.replace(/\\/g, "/");
}

function getServerRoot(): string {
  if (isDev) return resolve(__dirname, "..");
  return resolve(process.resourcesPath, "server");
}

async function startNextServer(): Promise<void> {
  serverPort = await findFreePort([3000, 3001, 3002, 3003, 3004, 3005]);

  if (isDev) {
    log("[electron] Dev mode — expecting Next.js at http://127.0.0.1:3000");
    serverPort = 3000;
    return;
  }

  const serverRoot = getServerRoot();
  const serverScript = join(serverRoot, "server.js");

  log("[electron] resourcesPath:", process.resourcesPath);
  log("[electron] serverRoot:", serverRoot);
  log("[electron] serverScript:", serverScript, "exists:", existsSync(serverScript));
  log("[electron] dbPath:", getDbPath());
  log("[electron] port:", serverPort);

  if (!existsSync(serverScript)) {
    throw new Error(
      `Next.js server not found at:\n${serverScript}\n\nresourcesPath: ${process.resourcesPath}`
    );
  }

  const dbPath = getDbPath();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(serverPort),
    HOSTNAME: "127.0.0.1",
    DATABASE_URL: `file:${dbPath}/database.db`,
    NEXTAUTH_URL: `http://127.0.0.1:${serverPort}`,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ?? "electron-local-secret-change-me",
    NODE_ENV: "production" as const,
  };

  log("[electron] spawning server with DATABASE_URL:", env.DATABASE_URL);

  // Collect stderr so we can show it in the error dialog if the server times out
  const stderrLines: string[] = [];

  serverProcess = spawn(process.execPath, [serverScript], {
    env,
    cwd: serverRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProcess.stdout?.on("data", (d: Buffer) => log("[server]", d.toString().trim()));
  serverProcess.stderr?.on("data", (d: Buffer) => {
    const text = d.toString().trim();
    log("[server:err]", text);
    stderrLines.push(text);
  });
  serverProcess.on("error", (e) => log("[server] spawn error:", e.message));
  serverProcess.on("exit", (code, signal) => log("[server] exited — code:", code, "signal:", signal));

  try {
    await waitForServer(`http://127.0.0.1:${serverPort}/api/setup`, 60_000);
    log("[electron] Server ready");
  } catch {
    const details = stderrLines.slice(-20).join("\n") || "(no output captured)";
    throw new Error(`Server did not start.\n\nLast output:\n${details}\n\nLog: ${app.getPath("userData")}\\app.log`);
  }
}

function waitForServer(url: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      fetch(url)
        .then(() => resolve())
        .catch(() => {
          if (Date.now() > deadline) {
            reject(new Error("timeout"));
          } else {
            setTimeout(check, 800);
          }
        });
    };
    check();
  });
}

// ── Window ────────────────────────────────────────────────────────────────────

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
  try { initLogger(); } catch { /* ignore — logBuffer will catch early logs */ }
  log(`[electron] App ready — version ${app.getVersion()}, packaged=${app.isPackaged}, platform=${process.platform}`);

  try {
    await startNextServer();
    createWindow();
    setupAutoUpdater();
  } catch (err) {
    const msg = String(err);
    log("[electron] Fatal:", msg);
    dialog.showErrorBox("خطأ في بدء التشغيل", msg);
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
  logStream?.end();
});
