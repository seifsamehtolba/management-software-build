/**
 * Reads GH_READ_TOKEN from the environment and writes it into
 * electron/update-token.ts so it gets compiled into the packaged app.
 * This file itself is gitignored — it's generated at build time only.
 */
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const token = process.env.GH_READ_TOKEN ?? "";

if (!token) {
  console.warn("[bake-update-token] GH_READ_TOKEN not set — auto-update will not work for private repo.");
}

const content = `// Auto-generated at build time — DO NOT COMMIT\nexport const GH_READ_TOKEN = ${JSON.stringify(token)};\n`;
const outPath = join(__dirname, "../electron/update-token.ts");
writeFileSync(outPath, content, "utf8");
console.log(`[bake-update-token] Written to electron/update-token.ts`);
