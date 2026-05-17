import { NextRequest, NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { branchScope } from "@/lib/quotes";

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function daysPastDue(dueDate: Date | null, today: Date) {
  if (!dueDate) return 0;
  const delta = startOfDay(today).getTime() - startOfDay(dueDate).getTime();
  return Math.max(0, Math.floor(delta / (24 * 60 * 60 * 1000)));
}

function agingBucket(daysOverdue: number) {
  if (daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "1_30";
  if (daysOverdue <= 60) return "31_60";
  return "61_plus";
}

export async function GET(req: NextRequest) {
  const auth = await requireApiAnyPermission([PERMISSIONS.financePayablesRead, PERMISSIONS.reportsFinanceRead]);
  if (!auth.ok) return auth.response;

  const requestedBranchId = req.nextUrl.searchParams.get("branchId")?.trim() ?? "";
  const effectiveBranchId = branchScope(auth.user, requestedBranchId, PERMISSIONS.reportsFinanceCrossBranch);
  const today = new Date();

  const purchaseOrders = await prisma.purchaseOrder.findMany({
    where: {
      status: { not: "CANCELLED" },
      ...(effectiveBranchId ? { branchId: effectiveBranchId } : {}),
    },
    include: {
      supplier: { select: { id: true, name: true, paymentTerms: true, outstandingBalance: true } },
      branch: { select: { id: true, name: true } },
      payments: {
        orderBy: { paidAt: "desc" },
        select: {
          id: true,
          amount: true,
          method: true,
          note: true,
          reference: true,
          paidAt: true,
          reversedAt: true,
          reversalNote: true,
        },
      },
    },
    orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
  });

  const rows = purchaseOrders
    .map((po) => {
      const total = Number(po.total);
      const paidAmount = Number(po.paidAmount);
      const outstanding = roundMoney(total - paidAmount);
      const overdueDays = daysPastDue(po.dueDate, today);
      const bucket = agingBucket(overdueDays) as "current" | "1_30" | "31_60" | "61_plus";
      return {
        id: po.id,
        poNumber: po.poNumber,
        supplierId: po.supplierId,
        supplierName: po.supplier.name,
        supplierTerms: po.supplier.paymentTerms,
        branchId: po.branchId,
        branchName: po.branch?.name ?? "Unassigned",
        status: po.status,
        total,
        paidAmount,
        outstanding,
        createdAt: po.createdAt.toISOString(),
        dueDate: po.dueDate?.toISOString() ?? null,
        overdueDays,
        agingBucket: bucket,
        payments: po.payments.map((payment) => ({
          id: payment.id,
          amount: Number(payment.amount),
          method: payment.method,
          note: payment.note,
          reference: payment.reference,
          paidAt: payment.paidAt.toISOString(),
          reversedAt: payment.reversedAt?.toISOString() ?? null,
          reversalNote: payment.reversalNote,
        })),
      };
    })
    .filter((row) => row.outstanding > 0 || row.payments.length > 0);

  const aging = rows.reduce(
    (acc, row) => {
      acc.totalOutstanding = roundMoney(acc.totalOutstanding + row.outstanding);
      acc[row.agingBucket] = roundMoney(acc[row.agingBucket] + row.outstanding);
      return acc;
    },
    {
      current: 0,
      "1_30": 0,
      "31_60": 0,
      "61_plus": 0,
      totalOutstanding: 0,
    },
  );

  return NextResponse.json({ rows, aging });
}
