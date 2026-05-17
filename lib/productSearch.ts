import { db, type LocalProduct } from "@/lib/localDb";
import { parseResponseJson } from "@/lib/parseResponseJson";

function normalize(input: string) {
  return input.trim().toLowerCase();
}

export async function findProduct(query: string): Promise<LocalProduct | null> {
  const normalized = normalize(query);
  if (!normalized) return null;

  const localExact =
    (await db.products.where("barcode").equals(query.trim()).first()) ??
    (await db.products.where("sku").equals(query.trim()).first());

  if (localExact) return localExact;

  const localByName = await db.products
    .filter((p) => p.name.toLowerCase().includes(normalized) || (p.nameAr ?? "").toLowerCase().includes(normalized))
    .first();
  if (localByName) return localByName;

  if (!navigator.onLine) return null;

  try {
    const res = await fetch(`/api/products/lookup?q=${encodeURIComponent(query.trim())}`);
    if (!res.ok) return null;
    const product = await parseResponseJson<LocalProduct>(res);
    if (!product) return null;
    await db.products.put({ ...product, syncStatus: "synced" });
    return product;
  } catch {
    return null;
  }
}
