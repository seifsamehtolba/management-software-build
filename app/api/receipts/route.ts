import { NextRequest, NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const auth = await requireApiAnyPermission([PERMISSIONS.salesReceiptsRead]);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const requestedBranchId = searchParams.get("branchId")?.trim() ?? "";

  const canCrossBranch = hasPermission(auth.user.permissions, PERMISSIONS.salesReceiptsCrossBranch);
  const effectiveBranchId = canCrossBranch ? requestedBranchId || null : auth.user.branchId;

  const receipts = await prisma.sale.findMany({
    where: {
      ...(q
        ? {
            OR: [
              { invoiceNumber: { contains: q } },
              { customer: { name: { contains: q } } },
            ],
          }
        : {}),
      ...(effectiveBranchId ? { cashier: { branchId: effectiveBranchId } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      cashier: {
        select: {
          id: true,
          name: true,
          branch: { select: { id: true, name: true } },
        },
      },
      items: {
        select: {
          id: true,
          productId: true,
          product: { select: { name: true } },
          quantity: true,
          refundedQty: true,
          unitPrice: true,
          total: true,
        },
      },
      refunds: {
        select: {
          id: true,
          amount: true,
          settlementMethod: true,
          refundMode: true,
          replacementSaleId: true,
          exchangeReference: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      },
      payments: {
        select: {
          id: true,
          method: true,
          amount: true,
          reference: true,
        },
      },
    },
  });

  return NextResponse.json({
    receipts: receipts.map((receipt) => ({
      ...receipt,
      subtotal: Number(receipt.subtotal),
      discountAmount: Number(receipt.discountAmount),
      taxAmount: Number(receipt.taxAmount),
      total: Number(receipt.total),
      items: receipt.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.product.name,
        quantity: item.quantity,
        refundedQty: item.refundedQty,
        unitPrice: Number(item.unitPrice),
        total: Number(item.total),
      })),
      refunds: receipt.refunds.map((refund) => ({
        ...refund,
        amount: Number(refund.amount),
        createdAt: refund.createdAt.toISOString(),
      })),
      payments: receipt.payments.map((payment) => ({
        ...payment,
        amount: Number(payment.amount),
      })),
    })),
  });
}
