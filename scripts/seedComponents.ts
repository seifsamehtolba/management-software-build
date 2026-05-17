import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
function slugifyName(value: string) {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28);
}

import { ComponentCategory, PrismaClient } from "@prisma/client";
import { parse } from "csv-parse/sync";

const prisma = new PrismaClient();

const fileMap: Array<{ file: string; category: ComponentCategory }> = [
  { file: "cpu.csv", category: ComponentCategory.CPU },
  { file: "gpu.csv", category: ComponentCategory.GPU },
  { file: "ram.csv", category: ComponentCategory.RAM },
  { file: "storage.csv", category: ComponentCategory.STORAGE_SSD },
  { file: "motherboard.csv", category: ComponentCategory.MOTHERBOARD },
  { file: "psu.csv", category: ComponentCategory.PSU },
];

function readRows(filePath: string): Record<string, string>[] {
  const raw = readFileSync(filePath, "utf8");
  return parse(raw, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
  }) as Record<string, string>[];
}

function getName(row: Record<string, string>) {
  return (row.name ?? row.Name ?? row.Part ?? "").trim();
}

function buildSpecs(row: Record<string, string>) {
  const specs: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    if (["name", "Name", "Part"].includes(key)) continue;
    const normalized = String(value ?? "").trim();
    if (!normalized) continue;
    specs[key] = normalized;
  }
  return specs;
}

async function seedFile(fileName: string, componentCategory: ComponentCategory) {
  const fullPath = path.join(process.cwd(), "data", fileName);
  if (!existsSync(fullPath)) {
    console.log(`Skipping ${fileName} (missing file)`);
    return;
  }
  const rows = readRows(fullPath);
  console.log(`Seeding ${fileName}: ${rows.length} rows`);

  for (const row of rows) {
    const name = getName(row);
    if (!name) continue;

    const brandName = (name.split(/\s+/)[0] ?? "Generic").trim();
    const specs = buildSpecs(row);
    const sku = `CMP-${componentCategory.slice(0, 3)}-${slugifyName(name) || "ITEM"}`;

    const [brand, category] = await Promise.all([
      prisma.brand.findFirst({ where: { name: brandName } }).then((existing) => {
        if (existing) return existing;
        return prisma.brand.create({ data: { name: brandName } });
      }),
      prisma.category.findFirst({ where: { name: componentCategory, parentId: null } }).then((existing) => {
        if (existing) return existing;
        return prisma.category.create({ data: { name: componentCategory, parentId: null } });
      }),
    ]);

    await prisma.product.upsert({
      where: { sku },
      update: {
        name,
        brandId: brand.id,
        categoryId: category.id,
        componentCategory,
        specs,
      },
      create: {
        sku,
        name,
        brandId: brand.id,
        categoryId: category.id,
        componentCategory,
        specs,
        costPrice: 0,
        sellPrice: 0,
        taxRate: 0.14,
        hasSerials: true,
        isActive: false,
      },
    });
  }
}

async function main() {
  for (const item of fileMap) {
    await seedFile(item.file, item.category);
  }
  console.log("Component seed completed.");
}

void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
