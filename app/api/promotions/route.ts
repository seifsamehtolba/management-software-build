import { NextRequest, NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { logActivity } from "@/lib/activity";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const auth = await requireApiAnyPermission([PERMISSIONS.promotionsRead, PERMISSIONS.promotionsManage]);
  if (!auth.ok) return auth.response;

  const [promotions, coupons, priceLists] = await Promise.all([
    prisma.promotion.findMany({
      include: {
        product: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.coupon.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.priceList.findMany({
      include: {
        items: {
          include: { product: { select: { id: true, name: true, sku: true, sellPrice: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return NextResponse.json({
    promotions: promotions.map((p) => ({
      ...p,
      value: Number(p.value),
      startsAt: p.startsAt.toISOString(),
      endsAt: p.endsAt.toISOString(),
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    })),
    coupons: coupons.map((c) => ({
      ...c,
      value: Number(c.value),
      expiresAt: c.expiresAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    })),
    priceLists: priceLists.map((pl) => ({
      ...pl,
      createdAt: pl.createdAt.toISOString(),
      updatedAt: pl.updatedAt.toISOString(),
      items: pl.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.product.name,
        productSku: item.product.sku,
        regularPrice: Number(item.product.sellPrice),
        price: Number(item.price),
      })),
    })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAnyPermission([PERMISSIONS.promotionsManage]);
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => ({}))) as {
    kind: "promotion" | "coupon" | "priceList";
    // promotion fields
    name?: string;
    type?: string;
    value?: number;
    productId?: string;
    categoryId?: string;
    startsAt?: string;
    endsAt?: string;
    minQty?: number;
    // coupon fields
    code?: string;
    maxUses?: number;
    expiresAt?: string;
    // priceList fields
    priceListType?: string;
    items?: Array<{ productId: string; price: number }>;
  };

  if (body.kind === "promotion") {
    if (!body.name || !body.type || body.value == null || !body.startsAt || !body.endsAt) {
      return NextResponse.json({ message: "name, type, value, startsAt, endsAt are required" }, { status: 400 });
    }
    const promo = await prisma.promotion.create({
      data: {
        name: body.name.trim(),
        type: body.type as never,
        value: body.value,
        productId: body.productId?.trim() || null,
        categoryId: body.categoryId?.trim() || null,
        startsAt: new Date(body.startsAt),
        endsAt: new Date(body.endsAt),
        minQty: body.minQty ?? null,
      },
    });
    await logActivity({ userId: auth.user.id, action: "PROMOTION_CREATED", tableName: "Promotion", recordId: promo.id, details: { name: body.name } });
    return NextResponse.json({ id: promo.id }, { status: 201 });
  }

  if (body.kind === "coupon") {
    if (!body.code || !body.type || body.value == null) {
      return NextResponse.json({ message: "code, type, value are required" }, { status: 400 });
    }
    const coupon = await prisma.coupon.create({
      data: {
        code: body.code.trim().toUpperCase(),
        type: body.type as never,
        value: body.value,
        maxUses: body.maxUses ?? null,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      },
    });
    await logActivity({ userId: auth.user.id, action: "COUPON_CREATED", tableName: "Coupon", recordId: coupon.id, details: { code: body.code } });
    return NextResponse.json({ id: coupon.id }, { status: 201 });
  }

  if (body.kind === "priceList") {
    if (!body.name || !body.priceListType) {
      return NextResponse.json({ message: "name and priceListType are required" }, { status: 400 });
    }
    const pl = await prisma.priceList.create({
      data: {
        name: body.name.trim(),
        type: body.priceListType as never,
        items: body.items?.length
          ? { create: body.items.map((item) => ({ productId: item.productId, price: item.price })) }
          : undefined,
      },
    });
    await logActivity({ userId: auth.user.id, action: "PRICE_LIST_CREATED", tableName: "PriceList", recordId: pl.id, details: { name: body.name } });
    return NextResponse.json({ id: pl.id }, { status: 201 });
  }

  return NextResponse.json({ message: "Invalid kind" }, { status: 400 });
}
