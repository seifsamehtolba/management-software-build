/**
 * Seeds the default owner account using Prisma (works with local PostgreSQL).
 * Run with: node scripts/seed-local.mjs
 */

import { createRequire } from "module";
import { readFileSync, existsSync } from "fs";

const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

// Load .env.local first, then .env
for (const f of [".env.local", ".env"]) {
  if (existsSync(f)) {
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)="?(.+?)"?\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set — copy .env.local.example to .env.local");
  process.exit(1);
}

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

const prisma = new PrismaClient();

try {
  console.log("Connecting to database...");
  await prisma.$connect();
  console.log("Connected");

  const existing = await prisma.user.findFirst({ where: { role: "OWNER" } });
  if (existing) {
    console.log(`Owner already exists: ${existing.email}`);
    process.exit(0);
  }

  const passwordHash = await bcrypt.hash("admin123", 12);
  await prisma.user.create({
    data: {
      name: "المالك",
      email: "admin@store.com",
      passwordHash,
      role: "OWNER",
      permissions: ALL_PERMISSIONS,
      isActive: true,
    },
  });

  console.log("");
  console.log("Default owner created!");
  console.log("  Email:    admin@store.com");
  console.log("  Password: admin123");
  console.log("");
  console.log("  Log in and you will be taken through store setup.");
  console.log("  Change your password in Settings after setup.");
} catch (err) {
  console.error("Error:", err.message);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
