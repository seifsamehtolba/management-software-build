/**
 * Seeds the default owner account into Neon via HTTP (no port 5432 needed).
 * Run with: node scripts/seed-admin.mjs
 * Or:       npm run seed
 */

import { createRequire } from "module";
import { readFileSync, existsSync } from "fs";
import { neon } from "@neondatabase/serverless";

// Load .env
const envPath = ".env";
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)="?(.+?)"?\s*$/);
    if (m) process.env[m[1]] = m[2];
  }
}

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL not set in .env");
  process.exit(1);
}

const require = createRequire(import.meta.url);
const bcrypt = require("bcryptjs");

const sql = neon(process.env.DATABASE_URL);

const ALL_PERMISSIONS = [
  "users.read","users.create","users.update","users.permissions.manage","users.activate",
  "settings.store.read","settings.store.update",
  "branches.read","branches.read_all",
  "customers.read","customers.create","customers.update","customers.blacklist","customers.statement.read",
  "quotes.read","quotes.create","quotes.update","quotes.send","quotes.remind","quotes.approve","quotes.convert","quotes.cross_branch","quotes.jobs.run",
  "inventory.read_for_quotes","inventory.cross_branch",
  "sales.receipts.read","sales.receipts.cross_branch","sales.notes.update","sales.refunds.manage",
  "reports.dashboard.read","reports.dashboard.cross_branch","reports.finance.read","reports.finance.cross_branch",
  "finance.expenses.manage","finance.supplier_payments.manage","finance.payables.read",
  "catalog.brands.create","catalog.categories.create",
  "products.create","products.update","products.archive",
  "components.search","components.import",
  "locations.create",
  "stock.adjust","stock.transfers.read","stock.transfers.manage",
  "suppliers.create","purchase_orders.create","purchase_orders.receive",
  "repairs.create","repairs.read","repairs.update",
  "cash_shifts.read","cash_shifts.manage",
  "hr.read","hr.manage",
  "payroll.read","payroll.manage","payroll.cross_branch","payroll.override.manage",
  "audit.read","loyalty.manage",
  "sync.preview","sync.mutate","sync.resolve","sync.force","sync.cross_branch",
  "elevation.code.issue","elevation.approvals.read","elevation.approvals.resolve","elevation.supervisor.approve",
  "integrations.eta.submit","integrations.eta.logs.read","integrations.eta.retry",
  "builds.read","builds.create","builds.update",
  "promotions.read","promotions.manage",
];

console.log("Connecting to Neon...");

try {
  // Test connection
  await sql`SELECT 1`;
  console.log("✓ Connected to Neon");

  // Check if owner already exists
  const existing = await sql`SELECT id, email FROM "User" WHERE role = 'OWNER'::"Role" LIMIT 1`;
  if (existing.length > 0) {
    console.log(`✓ Owner already exists: ${existing[0].email}`);
    console.log("  Delete it first if you want to re-seed.");
    process.exit(0);
  }

  // Create default owner
  const passwordHash = await bcrypt.hash("admin123", 12);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await sql`
    INSERT INTO "User" (id, name, email, "passwordHash", role, permissions, "isActive", "createdAt", "updatedAt")
    VALUES (
      ${id},
      ${"المالك"},
      ${"admin@store.com"},
      ${passwordHash},
      'OWNER'::"Role",
      ${JSON.stringify(ALL_PERMISSIONS)}::jsonb,
      true,
      ${now}::timestamp,
      ${now}::timestamp
    )
  `;

  console.log("");
  console.log("✓ Default owner created!");
  console.log("  Email:    admin@store.com");
  console.log("  Password: admin123");
  console.log("");
  console.log("  Log in and you will be taken through store setup.");
  console.log("  Change your password in Settings after setup.");

} catch (err) {
  console.error("❌ Error:", err.message);
  process.exit(1);
}
