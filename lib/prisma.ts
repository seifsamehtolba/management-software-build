import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const dev = process.env.NODE_ENV === "development";
  // Neon requires its HTTP adapter; local/standard PostgreSQL uses the built-in driver
  if (connectionString.includes("neon.tech")) {
    const adapter = new PrismaNeon({ connectionString });
    return new PrismaClient({ adapter, log: dev ? ["error", "warn"] : ["error"] });
  }
  return new PrismaClient({ log: dev ? ["error", "warn"] : ["error"] });
}

/**
 * In development, `globalThis.prisma` can survive HMR while `@prisma/client` is regenerated,
 * leaving a stale singleton whose model delegates don't match the current schema. Recreate
 * when any expected delegate is missing (e.g. `elevationCode` or `elevationApproval`).
 */
function elevationDelegatesPresent(client: PrismaClient): boolean {
  const c = client as unknown as { elevationCode?: unknown; elevationApproval?: unknown };
  return typeof c.elevationCode !== "undefined" && typeof c.elevationApproval !== "undefined";
}

function getPrisma(): PrismaClient {
  const cached = globalForPrisma.prisma;
  const stale = cached != null && !elevationDelegatesPresent(cached);
  if (cached != null && !stale) {
    return cached;
  }
  if (stale) {
    void cached.$disconnect().catch(() => {});
  }
  const client = createPrismaClient();
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = client;
  }
  return client;
}

export const prisma = getPrisma();
