import { NextRequest, NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { logActivity } from "@/lib/activity";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireApiAnyPermission([PERMISSIONS.financeSupplierPaymentsManage]);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { note?: string };
  const reversalNote = body.note?.trim() || "Manual reversal";

  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.supplierPayment.findUnique({
      where: { id },
      include: {
        po: {
          select: {
            id: true,
            supplierId: true,
          },
        },
      },
    });

    if (!payment) {
      return { ok: false as const, message: "Payment not found" };
    }

    if (payment.reversedAt) {
      return { ok: false as const, message: "Payment is already reversed" };
    }

    await tx.supplierPayment.update({
      where: { id },
      data: {
        reversedAt: new Date(),
        reversalNote,
      },
    });

    await tx.purchaseOrder.update({
      where: { id: payment.poId },
      data: {
        paidAmount: {
          decrement: payment.amount,
        },
      },
    });

    await tx.supplier.update({
      where: { id: payment.po.supplierId },
      data: {
        outstandingBalance: {
          increment: payment.amount,
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
    action: "SUPPLIER_PAYMENT_REVERSED",
    tableName: "SupplierPayment",
    recordId: id,
    details: { note: reversalNote, poId: result.payment.poId, amount: Number(result.payment.amount) },
  });

  return NextResponse.json({ ok: true });
}
