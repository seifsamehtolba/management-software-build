import { NextRequest, NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { logActivity } from "@/lib/activity";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { branchScope } from "@/lib/quotes";

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

export async function GET(req: NextRequest) {
  const auth = await requireApiAnyPermission([PERMISSIONS.reportsFinanceRead]);
  if (!auth.ok) return auth.response;

  const requestedBranchId = req.nextUrl.searchParams.get("branchId")?.trim() ?? "";
  const effectiveBranchId = branchScope(auth.user, requestedBranchId, PERMISSIONS.reportsFinanceCrossBranch);

  const purchaseOrders = await prisma.purchaseOrder.findMany({
    where: {
      status: { not: "CANCELLED" },
      ...(effectiveBranchId ? { branchId: effectiveBranchId } : {}),
    },
    select: {
      id: true,
      poNumber: true,
      total: true,
      paidAmount: true,
      dueDate: true,
      supplier: { select: { name: true } },
      branch: { select: { name: true } },
      payments: {
        select: {
          id: true,
          amount: true,
          method: true,
          paidAt: true,
          note: true,
          reversedAt: true,
          reversalNote: true,
        },
        orderBy: { paidAt: "desc" },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json(
    purchaseOrders.map((po) => ({
      id: po.id,
      poNumber: po.poNumber,
      supplierName: po.supplier.name,
      branchName: po.branch?.name ?? "Unassigned",
      total: Number(po.total),
      paidAmount: Number(po.paidAmount),
      outstanding: roundMoney(Number(po.total) - Number(po.paidAmount)),
      dueDate: po.dueDate?.toISOString() ?? null,
      payments: po.payments.map((payment) => ({
        id: payment.id,
        amount: Number(payment.amount),
        method: payment.method,
        note: payment.note,
        paidAt: payment.paidAt.toISOString(),
        reversedAt: payment.reversedAt?.toISOString() ?? null,
        reversalNote: payment.reversalNote,
      })),
    })),
  );
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAnyPermission([PERMISSIONS.financeSupplierPaymentsManage]);
  if (!auth.ok) return auth.response;

  const body = (await req.json()) as {
    poId?: string;
    amount?: number;
    method?: string;
    reference?: string;
    note?: string;
    paidAt?: string;
  };

  const poId = body.poId?.trim();
  const amount = Number(body.amount);
  const method = body.method?.trim();
  if (!poId || !Number.isFinite(amount) || amount <= 0 || !method) {
    return NextResponse.json({ message: "poId, amount, and method are required" }, { status: 400 });
  }

  const result = await prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({
      where: { id: poId },
      select: {
        id: true,
        total: true,
        paidAmount: true,
        supplierId: true,
      },
    });

    if (!po) {
      return { ok: false as const, message: "Purchase order not found" };
    }

    const outstanding = roundMoney(Number(po.total) - Number(po.paidAmount));
    if (amount > outstanding) {
      return { ok: false as const, message: "Payment exceeds PO outstanding amount" };
    }

    const payment = await tx.supplierPayment.create({
      data: {
        poId,
        amount,
        method: method as never,
        reference: body.reference?.trim() || null,
        note: body.note?.trim() || null,
        userId: auth.user.id,
        paidAt: body.paidAt ? new Date(body.paidAt) : new Date(),
      },
    });

    await tx.purchaseOrder.update({
      where: { id: poId },
      data: {
        paidAmount: {
          increment: amount,
        },
      },
    });

    await tx.supplier.update({
      where: { id: po.supplierId },
      data: {
        outstandingBalance: {
          decrement: amount,
        },
      },
    });

    return { ok: true as const, payment };
  });

  if (!result.ok) {
    return NextResponse.json({ message: result.message }, { status: 400 });
  }

  await logActivity({
    userId: auth.user.id,
    action: "SUPPLIER_PAYMENT_CREATED",
    tableName: "SupplierPayment",
    recordId: result.payment.id,
    details: { poId, amount, method },
  });

  return NextResponse.json({
    id: result.payment.id,
    amount: Number(result.payment.amount),
    method: result.payment.method,
    note: result.payment.note,
    paidAt: result.payment.paidAt.toISOString(),
  }, { status: 201 });
}
