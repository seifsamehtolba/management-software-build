import { NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { logActivity } from "@/lib/activity";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  const auth = await requireApiAnyPermission([PERMISSIONS.cashShiftsManage]);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { countedCash?: number; notes?: string };
  const countedCash = Number(body.countedCash ?? 0);
  if (!Number.isFinite(countedCash) || countedCash < 0) {
    return NextResponse.json({ message: "Valid counted cash is required" }, { status: 400 });
  }

  const result = await prisma.$transaction(async (tx) => {
    const shift = await tx.cashShift.findUnique({
      where: { id },
      include: {
        entries: {
          select: { amount: true, type: true },
        },
      },
    });
    if (!shift) {
      return { ok: false as const, message: "Shift not found" };
    }
    if (shift.status !== "OPEN") {
      return { ok: false as const, message: "Shift is already closed" };
    }
    if (shift.userId !== auth.user.id) {
      return { ok: false as const, status: 403, message: "You can only close your own shift" };
    }

    const expectedCash = roundMoney(
      shift.entries.reduce((sum, entry) => {
        if (entry.type === "REFUND_CASH" || entry.type === "PAYOUT") {
          return sum - Number(entry.amount);
        }
        return sum + Number(entry.amount);
      }, 0),
    );
    const variance = roundMoney(countedCash - expectedCash);

    await tx.cashShiftEntry.create({
      data: {
        shiftId: id,
        userId: auth.user.id,
        type: "CLOSE",
        amount: countedCash,
        note: body.notes?.trim() || "Shift closed",
      },
    });

    await tx.cashShift.update({
      where: { id },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        countedCash,
        expectedCash,
        variance,
        notes: body.notes?.trim() || shift.notes,
      },
    });

    return { ok: true as const, expectedCash, variance };
  });

  if (!result.ok) {
    return NextResponse.json({ message: result.message }, { status: "status" in result ? result.status : 400 });
  }

  await logActivity({
    userId: auth.user.id,
    action: "CASH_SHIFT_CLOSED",
    tableName: "CashShift",
    recordId: id,
    details: { expectedCash: result.expectedCash, countedCash: roundMoney(countedCash), variance: result.variance },
  });

  return NextResponse.json(result);
}
