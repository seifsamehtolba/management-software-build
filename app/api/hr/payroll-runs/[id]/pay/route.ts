import { NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { logActivity } from "@/lib/activity";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function POST(_: Request, { params }: Params) {
  const auth = await requireApiAnyPermission([PERMISSIONS.payrollManage]);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const run = await prisma.payrollRun.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!run) {
    return NextResponse.json({ message: "Payroll run not found" }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.payrollRun.update({
      where: { id },
      data: {
        status: "PAID",
        paidAt: new Date(),
      },
    });
    await tx.payrollItem.updateMany({
      where: { payrollRunId: id },
      data: {
        paymentStatus: "PAID",
        paidAt: new Date(),
      },
    });
  });

  await logActivity({
    userId: auth.user.id,
    action: "PAYROLL_RUN_PAID",
    tableName: "PayrollRun",
    recordId: id,
    details: { previousStatus: run.status },
  });

  return NextResponse.json({ ok: true });
}
