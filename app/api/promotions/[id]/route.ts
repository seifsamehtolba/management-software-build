import { NextRequest, NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { logActivity } from "@/lib/activity";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireApiAnyPermission([PERMISSIONS.promotionsManage]);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    kind: "promotion" | "coupon" | "priceList";
    isActive?: boolean;
    name?: string;
    endsAt?: string;
  };

  if (body.kind === "promotion") {
    await prisma.promotion.update({
      where: { id },
      data: {
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.endsAt !== undefined ? { endsAt: new Date(body.endsAt) } : {}),
      },
    });
  } else if (body.kind === "coupon") {
    await prisma.coupon.update({
      where: { id },
      data: { ...(body.isActive !== undefined ? { isActive: body.isActive } : {}) },
    });
  } else if (body.kind === "priceList") {
    await prisma.priceList.update({
      where: { id },
      data: { ...(body.isActive !== undefined ? { isActive: body.isActive } : {}) },
    });
  } else {
    return NextResponse.json({ message: "Invalid kind" }, { status: 400 });
  }

  await logActivity({ userId: auth.user.id, action: "PROMOTION_UPDATED", tableName: "Promotion", recordId: id, details: body });
  return NextResponse.json({ ok: true });
}
