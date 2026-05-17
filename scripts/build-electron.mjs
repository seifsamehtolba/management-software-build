import { build } from "esbuild";
import { rmSync, mkdirSync } from "fs";

rmSync("dist-electron", { recursive: true, force: true });
mkdirSync("dist-electron", { recursive: true });

const shared = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  // electron is provided by the runtime — never bundle it
  external: ["electron"],
  minify: false,
  sourcemap: false,
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
