import { NextRequest, NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  const { id } = await params;
  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      sales: {
        orderBy: { createdAt: "desc" },
        take: 50,
        include: {
          payments: {
            orderBy: { createdAt: "desc" },
          },
          refunds: {
            orderBy: { createdAt: "desc" },
          },
        },
      },
      quotes: {
        orderBy: { createdAt: "desc" },
        take: 50,
      },
      repairTickets: {
        orderBy: { createdAt: "desc" },
        take: 50,
        include: {
          notes: {
            orderBy: { createdAt: "desc" },
            take: 5,
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!customer) {
    return NextResponse.json({ message: "Customer not found" }, { status: 404 });
  }
  const activityLogs = await prisma.activityLog.findMany({
    where: {
      OR: [{ recordId: customer.id }, { action: { contains: customer.phone } }],
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json({
    ...customer,
    creditBalance: Number(customer.creditBalance),
    createdAt: customer.createdAt.toISOString(),
    updatedAt: customer.updatedAt.toISOString(),
    sales: customer.sales.map((sale) => ({
      ...sale,
      subtotal: Number(sale.subtotal),
      discountAmount: Number(sale.discountAmount),
      taxAmount: Number(sale.taxAmount),
      total: Number(sale.total),
      createdAt: sale.createdAt.toISOString(),
      updatedAt: sale.updatedAt.toISOString(),
      payments: sale.payments.map((payment) => ({
        ...payment,
        amount: Number(payment.amount),
        createdAt: payment.createdAt.toISOString(),
      })),
      refunds: sale.refunds.map((refund) => ({
        ...refund,
        amount: Number(refund.amount),
        createdAt: refund.createdAt.toISOString(),
      })),
    })),
    quotes: customer.quotes.map((quote) => ({
      ...quote,
      subtotal: Number(quote.subtotal),
      total: Number(quote.total),
      validUntil: quote.validUntil?.toISOString() ?? null,
      sentAt: quote.sentAt?.toISOString() ?? null,
      approvedAt: quote.approvedAt?.toISOString() ?? null,
      rejectedAt: quote.rejectedAt?.toISOString() ?? null,
      convertedAt: quote.convertedAt?.toISOString() ?? null,
      lastReminderAt: quote.lastReminderAt?.toISOString() ?? null,
      nextReminderAt: quote.nextReminderAt?.toISOString() ?? null,
      createdAt: quote.createdAt.toISOString(),
      updatedAt: quote.updatedAt.toISOString(),
    })),
    repairTickets: customer.repairTickets.map((ticket) => ({
      ...ticket,
      estimatedCost: ticket.estimatedCost ? Number(ticket.estimatedCost) : null,
      laborCost: ticket.laborCost ? Number(ticket.laborCost) : null,
      finalCost: ticket.finalCost ? Number(ticket.finalCost) : null,
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
      notes: ticket.notes.map((note) => ({
        ...note,
        createdAt: note.createdAt.toISOString(),
      })),
    })),
    activityLogs: activityLogs.map((log) => ({
      ...log,
      createdAt: log.createdAt.toISOString(),
    })),
  });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireApiAnyPermission([PERMISSIONS.customersUpdate]);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = (await req.json()) as {
    name?: string;
    phone?: string;
    email?: string | null;
    address?: string | null;
    nationalId?: string | null;
    notes?: string | null;
    type?: "REGULAR" | "VIP" | "WHOLESALE";
    creditBalance?: number;
    loyaltyPoints?: number;
    isBlacklisted?: boolean;
  };

  const updated = await prisma.customer.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name.trim() } : {}),
      ...(body.phone !== undefined ? { phone: body.phone.trim() } : {}),
      ...(body.email !== undefined ? { email: body.email?.trim() || null } : {}),
      ...(body.address !== undefined ? { address: body.address?.trim() || null } : {}),
      ...(body.nationalId !== undefined ? { nationalId: body.nationalId?.trim() || null } : {}),
      ...(body.notes !== undefined ? { notes: body.notes?.trim() || null } : {}),
      ...(body.type !== undefined ? { type: body.type } : {}),
      ...(body.creditBalance !== undefined ? { creditBalance: body.creditBalance } : {}),
      ...(body.loyaltyPoints !== undefined ? { loyaltyPoints: body.loyaltyPoints } : {}),
      ...(body.isBlacklisted !== undefined ? { isBlacklisted: body.isBlacklisted } : {}),
    },
  });

  await prisma.activityLog.create({
    data: {
      userId: auth.user.id,
      action: "CUSTOMER_UPDATED",
      tableName: "customers",
      recordId: updated.id,
      details: {
        changedFields: Object.keys(body),
      },
    },
  });

  return NextResponse.json({
    ...updated,
    creditBalance: Number(updated.creditBalance),
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  });
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const auth = await requireApiAnyPermission([PERMISSIONS.customersBlacklist]);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  await prisma.customer.update({
    where: { id },
    data: { isBlacklisted: true },
  });

  await prisma.activityLog.create({
    data: {
      userId: auth.user.id,
      action: "CUSTOMER_BLACKLISTED",
      tableName: "customers",
      recordId: id,
    },
  });

  return NextResponse.json({ ok: true });
}
