import { build } from "esbuild";
import { rmSync, mkdirSync } from "fs";

rmSync("dist-electron", { recursive: true, force: true });
mkdirSync("dist-electron", { recursive: true });

// Runs before ANY module code — suppresses EPIPE so electron-log / electron-updater
// can't crash the process by writing to a broken stdout in a packaged app.
const epipeBanner = `
if (process.stdout) process.stdout.on('error', function(e) { if (e.code === 'EPIPE') return; });
if (process.stderr) process.stderr.on('error', function(e) { if (e.code === 'EPIPE') return; });
process.on('uncaughtException', function(e) { if (e.code === 'EPIPE') return; throw e; });
`.trim();

const shared = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  external: ["electron"],
  minify: false,
  sourcemap: false,
  banner: { js: epipeBanner },
};

await Promise.all([
  build({
    ...shared,
    entryPoints: ["electron/main.ts"],
    outfile: "dist-electron/main.js",
  }),
  build({
    ...shared,
    entryPoints: ["electron/preload.ts"],
    outfile: "dist-electron/preload.js",
  }),
]);

console.log("✓ Electron bundle complete");
