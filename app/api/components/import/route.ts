import { ComponentCategory, Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  name: z.string().trim().min(1),
  brand: z.string().trim().optional(),
  category: z.string().trim().optional(),
  componentCategory: z.nativeEnum(ComponentCategory).optional(),
  specs: z.record(z.string(), z.string()).optional(),
  imageUrl: z.string().url().optional(),
  barcode: z.string().trim().optional(),
  externalRef: z.string().trim().optional(),
  suggestedPriceUsd: z.number().nonnegative().optional(),
  costPrice: z.number().nonnegative(),
  sellPrice: z.number().nonnegative(),
  sku: z.string().trim().optional(),
  reorderPoint: z.number().int().nonnegative().default(3),
});

function fallbackCategoryName(input: z.infer<typeof bodySchema>) {
  if (input.category) return input.category;
  if (input.componentCategory) return input.componentCategory.replaceAll("_", " ");
  return "OTHER";
}

async function generateSku(componentCategory?: ComponentCategory) {
  const prefix = (componentCategory ?? "COM").slice(0, 3).toUpperCase();
  const count = await prisma.product.count();
  return `${prefix}-${String(count + 1).padStart(5, "0")}`;
}

async function findOrCreateBrand(name: string) {
  const existing = await prisma.brand.findFirst({ where: { name } });
  if (existing) return existing;
  return prisma.brand.create({ data: { name } });
}

async function findOrCreateCategory(name: string) {
  const existing = await prisma.category.findFirst({ where: { name, parentId: null } });
  if (existing) return existing;
  return prisma.category.create({ data: { name, parentId: null } });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAnyPermission([PERMISSIONS.componentsImport]);
  if (!auth.ok) return auth.response;

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
  }
  const body = parsed.data;

  const cleanBarcode = body.barcode?.trim() || undefined;
  if (cleanBarcode) {
    const existing = await prisma.product.findUnique({
      where: { barcode: cleanBarcode },
    });
    if (existing) {
      return NextResponse.json(existing);
    }
  }

  const [brandRecord, categoryRecord] = await Promise.all([
    body.brand ? findOrCreateBrand(body.brand) : Promise.resolve(null),
    findOrCreateCategory(fallbackCategoryName(body)),
  ]);

  const sku = body.sku || (await generateSku(body.componentCategory));
  const product = await prisma.product.create({
    data: {
      sku,
      barcode: cleanBarcode ?? null,
      name: body.name,
      brandId: brandRecord?.id ?? null,
      categoryId: categoryRecord.id,
      componentCategory: body.componentCategory ?? null,
      specs: body.specs ? (body.specs as Prisma.InputJsonValue) : Prisma.JsonNull,
      externalRef: body.externalRef ?? null,
      imageUrl: body.imageUrl ?? null,
      suggestedPriceUsd: body.suggestedPriceUsd ?? null,
      reorderPoint: body.reorderPoint,
      costPrice: body.costPrice,
      sellPrice: body.sellPrice,
      taxRate: 0.14,
      hasSerials: true,
      isActive: true,
    },
  });

  return NextResponse.json(product, { status: 201 });
}
