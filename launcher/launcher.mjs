import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { mkdirSync, existsSync, copyFileSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Port finder ────────────────────────────────────────────────────────────────

function findFreePort(start = 3000) {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(start, "127.0.0.1", () => srv.close(() => resolve(start)));
    srv.on("error", () => findFreePort(start + 1).then(resolve));
  });
}

// ── Wait for HTTP server ───────────────────────────────────────────────────────

function waitForServer(url, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = async () => {
      try {
        await fetch(url);
        resolve();
      } catch {
        if (Date.now() > deadline) reject(new Error("Server did not start within 60 seconds"));
        else setTimeout(attempt, 800);
      }
    };
    attempt();
  });
}

// ── Open default browser ───────────────────────────────────────────────────────

function openBrowser(url) {
  const { platform } = process;
  if (platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
  } else if (platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  }
}

// ── Data directory ─────────────────────────────────────────────────────────────

const dataDir = process.platform === "win32"
  ? join(process.env.APPDATA || process.env.USERPROFILE || ".", "StoreManager")
  : join(process.env.HOME || ".", ".store-manager");

mkdirSync(dataDir, { recursive: true });

// Persistent secret — generated once, stored in user data dir
const secretPath = join(dataDir, ".secret");
let secret;
if (existsSync(secretPath)) {
  secret = readFileSync(secretPath, "utf8").trim();
} else {
  secret = randomBytes(32).toString("hex");
  writeFileSync(secretPath, secret, { mode: 0o600 });
}

// Seed database for fresh installs
const dbPath = join(dataDir, "database.db");
const seedPath = join(__dirname, "server", "seed.db");
if (!existsSync(dbPath) && existsSync(seedPath)) {
  copyFileSync(seedPath, dbPath);
  console.log("[launcher] Initialized fresh database");
}

// ── Start server ───────────────────────────────────────────────────────────────

const port = await findFreePort(3000);
const serverDir = join(__dirname, "server");

const serverEnv = {
  ...process.env,
  PORT: String(port),
  HOSTNAME: "127.0.0.1",
  DATABASE_URL: `file:${dbPath.replace(/\\/g, "/")}`,
  NEXTAUTH_URL: `http://127.0.0.1:${port}`,
  NEXTAUTH_SECRET: secret,
  NODE_ENV: "production",
};

// Write URL to file so the open script can find it
const urlFile = join(dataDir, ".url");
writeFileSync(urlFile, `http://127.0.0.1:${port}`);

// Clean up URL file on exit
process.on("exit", () => { try { rmSync(urlFile, { force: true }); } catch {} });
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

console.log(`[launcher] Starting server on port ${port}...`);

const server = spawn(process.execPath, [join(serverDir, "server.js")], {
  env: serverEnv,
  cwd: serverDir,
  stdio: ["ignore", "pipe", "pipe"],
});

server.stdout.on("data", (d) => process.stdout.write(d));
server.stderr.on("data", (d) => process.stderr.write(d));
server.on("error", (err) => {
  console.error("[launcher] Failed to start server:", err.message);
  process.exit(1);
});
server.on("exit", (code) => process.exit(code ?? 0));

try {
  await waitForServer(`http://127.0.0.1:${port}/api/setup`);
  console.log(`[launcher] Ready → http://127.0.0.1:${port}`);
  openBrowser(`http://127.0.0.1:${port}`);
} catch (err) {
  console.error("[launcher]", err.message);
  console.error("[launcher] Check output above for server errors.");
}
