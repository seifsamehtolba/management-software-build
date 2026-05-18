/**
 * Packages the Next.js standalone server + launcher into a distributable ZIP.
 *
 * Usage:
 *   node scripts/package-server.mjs --mac   (default on macOS)
 *   node scripts/package-server.mjs --win   (downloads node.exe from nodejs.org)
 */

import {
  cpSync, mkdirSync, rmSync, existsSync, writeFileSync,
  copyFileSync, chmodSync, createWriteStream,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { execSync } from "node:child_process";
import { get } from "node:https";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const NODE_VERSION = "20.19.2";

const args = process.argv.slice(2);
const target = args.includes("--win") ? "win"
  : args.includes("--mac") ? "mac"
  : process.platform === "win32" ? "win" : "mac";

// ── Helpers ────────────────────────────────────────────────────────────────────

function download(url, dest) {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        res.resume();
        return download(res.headers.location, dest).then(resolve, reject);
      }
      const file = createWriteStream(dest);
      res.pipe(file);
      file.on("finish", () => file.close(() => resolve()));
      file.on("error", (err) => { rmSync(dest, { force: true }); reject(err); });
    }).on("error", reject);
  });
}

function run(cmd, opts = {}) {
  return execSync(cmd, { stdio: "inherit", cwd: ROOT, ...opts });
}

// ── Copy shared server files ───────────────────────────────────────────────────

function copyServerFiles(dist) {
  const standalone = join(ROOT, ".next/standalone");
  if (!existsSync(standalone)) {
    throw new Error(
      ".next/standalone not found.\n" +
      "Run: ELECTRON_BUILD=1 next build --webpack\n" +
      "(requires output: 'standalone' in next.config.ts)"
    );
  }

  console.log("Copying Next.js standalone...");
  cpSync(standalone, join(dist, "server"), { recursive: true });

  console.log("Copying .next/static...");
  cpSync(join(ROOT, ".next/static"), join(dist, "server/.next/static"), { recursive: true });

  if (existsSync(join(ROOT, "public"))) {
    console.log("Copying public/...");
    cpSync(join(ROOT, "public"), join(dist, "server/public"), { recursive: true });
  }

  // Prisma native engines — not included in standalone automatically
  const prismaClient = join(ROOT, "node_modules/.prisma");
  if (existsSync(prismaClient)) {
    console.log("Copying Prisma engines...");
    cpSync(prismaClient, join(dist, "server/node_modules/.prisma"), { recursive: true });
  }

  // Prisma schema (needed by migrate/push at runtime)
  const schema = join(ROOT, "prisma/schema.prisma");
  if (existsSync(schema)) {
    mkdirSync(join(dist, "server/prisma"), { recursive: true });
    copyFileSync(schema, join(dist, "server/prisma/schema.prisma"));
  }
}

// ── Seed database ──────────────────────────────────────────────────────────────

function createSeedDb(dist) {
  const seedPath = join(dist, "server/seed.db");
  console.log("Creating seed database...");
  try {
    execSync("npx prisma db push --skip-generate --accept-data-loss", {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: `file:${seedPath.replace(/\\/g, "/")}` },
      stdio: "pipe",
    });
    console.log("✓ Seed database created");
  } catch (e) {
    const msg = e.stderr?.toString() || e.message;
    console.warn("⚠ Could not create seed database:", msg);
    console.warn("  Users will need to set up the DB schema manually.");
  }
}

// ── Windows ────────────────────────────────────────────────────────────────────

async function packageWin() {
  const dist = join(ROOT, "dist-server-win");
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });

  copyServerFiles(dist);
  createSeedDb(dist);

  copyFileSync(join(ROOT, "launcher/launcher.mjs"), join(dist, "launcher.mjs"));

  // Download node.exe (cache the zip so re-runs are fast)
  const zipPath = join(ROOT, `.cache-node-win-${NODE_VERSION}.zip`);
  if (!existsSync(zipPath)) {
    const url = `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip`;
    console.log(`Downloading Node.js ${NODE_VERSION} for Windows (~16 MB)...`);
    await download(url, zipPath);
    console.log("✓ Download complete");
  } else {
    console.log(`Using cached Node.js zip`);
  }

  console.log("Extracting node.exe...");
  execSync(
    `unzip -j "${zipPath}" "node-v${NODE_VERSION}-win-x64/node.exe" -d "${dist}"`,
    { stdio: "pipe" }
  );

  // start.bat — double-clickable launcher
  writeFileSync(
    join(dist, "start.bat"),
    "@echo off\r\n" +
    "title StoreManager\r\n" +
    "cd /d \"%~dp0\"\r\n" +
    "echo Starting StoreManager...\r\n" +
    "echo The browser will open automatically.\r\n" +
    "echo Keep this window open while using the app.\r\n" +
    "echo To reopen the browser: run open.bat\r\n" +
    "echo.\r\n" +
    "node.exe launcher.mjs\r\n" +
    "pause\r\n",
    "utf8"
  );

  // open.bat — reopen the browser without restarting the server
  writeFileSync(
    join(dist, "open.bat"),
    "@echo off\r\n" +
    "set URLFILE=%APPDATA%\\StoreManager\\.url\r\n" +
    "if not exist \"%URLFILE%\" (\r\n" +
    "  echo StoreManager is not running. Please run start.bat first.\r\n" +
    "  pause\r\n" +
    "  exit /b 1\r\n" +
    ")\r\n" +
    "set /p URL=<\"%URLFILE%\"\r\n" +
    "start \"\" \"%URL%\"\r\n",
    "utf8"
  );

  // README
  writeFileSync(
    join(dist, "README.txt"),
    "StoreManager\r\n" +
    "============\r\n\r\n" +
    "To start: double-click start.bat\r\n" +
    "To reopen browser (server already running): double-click open.bat\r\n\r\n" +
    "Keep the command window open while using the app.\r\n" +
    "Close the command window to stop the server.\r\n\r\n" +
    "Your data is stored in: %APPDATA%\\StoreManager\\\r\n",
    "utf8"
  );

  // Create ZIP
  const zipOut = join(ROOT, "dist-server-win.zip");
  rmSync(zipOut, { force: true });
  execSync(`zip -r "${zipOut}" "dist-server-win/"`, { cwd: ROOT, stdio: "pipe" });
  console.log(`\n✓ Windows package ready: dist-server-win.zip`);
  console.log(`  Distribute this ZIP — users extract and run start.bat`);
}

// ── macOS ──────────────────────────────────────────────────────────────────────

async function packageMac() {
  const dist = join(ROOT, "dist-server-mac");
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });

  copyServerFiles(dist);
  createSeedDb(dist);

  copyFileSync(join(ROOT, "launcher/launcher.mjs"), join(dist, "launcher.mjs"));

  // Bundle current node binary
  console.log("Copying Node.js binary...");
  const nodeOut = join(dist, "node");
  copyFileSync(process.execPath, nodeOut);
  chmodSync(nodeOut, 0o755);

  // start.command — double-clickable in Finder
  writeFileSync(
    join(dist, "start.command"),
    "#!/bin/bash\n" +
    "cd \"$(dirname \"$0\")\"\n" +
    "echo 'Starting StoreManager...'\n" +
    "echo 'The browser will open automatically.'\n" +
    "echo 'To reopen the browser: run open.command'\n" +
    "./node launcher.mjs\n",
    "utf8"
  );
  chmodSync(join(dist, "start.command"), 0o755);

  // open.command — reopen the browser without restarting the server
  writeFileSync(
    join(dist, "open.command"),
    "#!/bin/bash\n" +
    "URLFILE=\"$HOME/.store-manager/.url\"\n" +
    "if [ ! -f \"$URLFILE\" ]; then\n" +
    "  osascript -e 'display alert \"StoreManager غير مفعّل\" message \"شغّل start.command أولاً ثم حاول مرة أخرى\"'\n" +
    "  exit 1\n" +
    "fi\n" +
    "open \"$(cat \"$URLFILE\")\"\n",
    "utf8"
  );
  chmodSync(join(dist, "open.command"), 0o755);

  // README
  writeFileSync(
    join(dist, "README.txt"),
    "StoreManager\n" +
    "============\n\n" +
    "To start: double-click start.command\n" +
    "To reopen browser (server already running): double-click open.command\n\n" +
    "If macOS blocks either script: right-click → Open → Open\n\n" +
    "Keep the Terminal window open while using the app.\n" +
    "Close the Terminal window to stop the server.\n\n" +
    "Your data is stored in: ~/.store-manager/\n",
    "utf8"
  );

  // Create ZIP
  const zipOut = join(ROOT, "dist-server-mac.zip");
  rmSync(zipOut, { force: true });
  execSync(`zip -r "${zipOut}" "dist-server-mac/"`, { cwd: ROOT, stdio: "pipe" });
  console.log(`\n✓ Mac package ready: dist-server-mac.zip`);
  console.log(`  Distribute this ZIP — users extract and double-click start.command`);
}

// ── Run ────────────────────────────────────────────────────────────────────────

console.log(`\nPackaging StoreManager for: ${target}\n`);

try {
  if (target === "win") {
    await packageWin();
  } else {
    await packageMac();
  }
} catch (err) {
  console.error("\n✗ Packaging failed:", err.message);
  process.exit(1);
}
