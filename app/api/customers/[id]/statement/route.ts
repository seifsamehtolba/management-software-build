import { NextRequest, NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  const auth = await requireApiAnyPermission([PERMISSIONS.customersStatementRead]);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      sales: {
        orderBy: { createdAt: "asc" },
        include: {
          payments: true,
          refunds: true,
        },
      },
    },
  });

  if (!customer) {
    return NextResponse.json({ message: "Customer not found" }, { status: 404 });
  }

  const entries = customer.sales.flatMap((sale) => {
    const saleEntry = {
      type: "SALE",
      date: sale.createdAt.toISOString(),
      reference: sale.invoiceNumber,
      amount: Number(sale.total),
      meta: { saleId: sale.id },
    };
    const paymentEntries = sale.payments.map((p) => ({
      type: "PAYMENT",
      date: p.createdAt.toISOString(),
      reference: `${sale.invoiceNumber}:${p.method}`,
      amount: -Number(p.amount),
      meta: { saleId: sale.id, paymentId: p.id },
    }));
    const refundEntries = sale.refunds.map((r) => ({
      type: "REFUND",
      date: r.createdAt.toISOString(),
      reference: `${sale.invoiceNumber}:REFUND`,
      amount: Number(r.amount),
      meta: { saleId: sale.id, refundId: r.id, reason: r.reason },
    }));
    return [saleEntry, ...paymentEntries, ...refundEntries];
  });

  const sorted = entries.sort((a, b) => a.date.localeCompare(b.date));
  let running = 0;
  const withRunning = sorted.map((entry) => {
    running += entry.amount;
    return { ...entry, runningBalance: Number(running.toFixed(2)) };
  });

  return NextResponse.json({
    customer: {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      creditBalance: Number(customer.creditBalance),
    },
    statement: withRunning,
    closingBalance: Number(running.toFixed(2)),
  });
}
