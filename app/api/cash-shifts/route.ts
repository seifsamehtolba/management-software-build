import { NextRequest, NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { logActivity } from "@/lib/activity";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

export async function GET(req: NextRequest) {
  const auth = await requireApiAnyPermission([PERMISSIONS.cashShiftsRead, PERMISSIONS.cashShiftsManage]);
  if (!auth.ok) return auth.response;

  const status = req.nextUrl.searchParams.get("status")?.trim();
  const branchId = req.nextUrl.searchParams.get("branchId")?.trim() || auth.user.branchId;

  const rows = await prisma.cashShift.findMany({
    where: {
      ...(status ? { status: status as never } : {}),
      ...(branchId ? { branchId } : {}),
    },
    include: {
      user: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true } },
      entries: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          type: true,
          amount: true,
          note: true,
          saleId: true,
          refundId: true,
          createdAt: true,
        },
      },
    },
    orderBy: { openedAt: "desc" },
    take: 50,
  });

  return NextResponse.json(
    rows.map((row) => ({
      id: row.id,
      status: row.status,
      branch: row.branch,
      user: row.user,
      openedAt: row.openedAt.toISOString(),
      closedAt: row.closedAt?.toISOString() ?? null,
      openingCash: Number(row.openingCash),
      expectedCash: Number(row.expectedCash),
      countedCash: row.countedCash == null ? null : Number(row.countedCash),
      variance: Number(row.variance),
      notes: row.notes,
      entries: row.entries.map((entry) => ({
        ...entry,
        amount: Number(entry.amount),
        createdAt: entry.createdAt.toISOString(),
      })),
    })),
  );
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAnyPermission([PERMISSIONS.cashShiftsManage]);
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => ({}))) as {
    branchId?: string;
    openingCash?: number;
    notes?: string;
  };

  const branchId = body.branchId?.trim() || auth.user.branchId;
  const openingCash = Number(body.openingCash ?? 0);
  if (!branchId || !Number.isFinite(openingCash) || openingCash < 0) {
    return NextResponse.json({ message: "Valid branch and opening cash are required" }, { status: 400 });
  }

  const existing = await prisma.cashShift.findFirst({
    where: {
      userId: auth.user.id,
      branchId,
      status: "OPEN",
    },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json({ message: "An open shift already exists for this user and branch" }, { status: 409 });
  }

  const shift = await prisma.cashShift.create({
    data: {
      branchId,
      userId: auth.user.id,
      openingCash,
      expectedCash: openingCash,
      notes: body.notes?.trim() || null,
      entries: {
        create: {
          userId: auth.user.id,
          type: "OPENING_FLOAT",
          amount: openingCash,
          note: "Shift opened",
        },
      },
    },
  });

  await logActivity({
    userId: auth.user.id,
    action: "CASH_SHIFT_OPENED",
    tableName: "CashShift",
    recordId: shift.id,
    details: { branchId, openingCash: roundMoney(openingCash) },
  });

  return NextResponse.json({ id: shift.id }, { status: 201 });
}
