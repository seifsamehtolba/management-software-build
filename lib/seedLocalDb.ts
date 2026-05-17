import { db } from "@/lib/localDb";
import { parseResponseJson } from "@/lib/parseResponseJson";

async function fetchJsonArray(url: string) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  });
  const contentType = response.headers.get("content-type") ?? "";

  if (!response.ok || !contentType.includes("application/json")) {
    return [];
  }

  const payload = await parseResponseJson<unknown>(response);
  return Array.isArray(payload) ? payload : [];
}

export async function seedLocalDB() {
  const [products, customers, stockLevels] = await Promise.all([
    fetchJsonArray("/api/seed/products?tier=1&limit=500"),
    fetchJsonArray("/api/seed/customers?fieldsOnly=id,name,phone,creditBalance,loyaltyPoints,type"),
    fetchJsonArray("/api/seed/stock"),
  ]);

  await db.transaction("rw", db.products, db.customers, db.stock_levels, async () => {
    await db.products.bulkPut(products);
    await db.customers.bulkPut(customers);
    await db.stock_levels.bulkPut(stockLevels);
  });

  localStorage.setItem("lastSeedAt", new Date().toISOString());
}
