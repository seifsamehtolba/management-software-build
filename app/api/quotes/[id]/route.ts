import { QuoteStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  branchScope,
  canAccessBranchScope,
  canTransitionQuoteStatus,
  computeInitialNextReminderAt,
  computeQuoteTotals,
  normalizeQuoteItems,
  quoteInclude,
  quoteUpdateSchema,
  serializeQuote,
} from "@/lib/quotes";

function canAccessQuote(
  auth: { permissions: string[]; branchId: string | null },
  quoteBranchId: string | null,
) {
  return canAccessBranchScope(auth, quoteBranchId, PERMISSIONS.quotesCrossBranch);
}

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAnyPermission([PERMISSIONS.quotesRead]);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const quote = await prisma.quote.findUnique({
    where: { id },
    include: quoteInclude(),
  });
  if (!quote) return NextResponse.json({ message: "Quote not found" }, { status: 404 });
  if (!canAccessQuote(auth.user, quote.branchId)) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(serializeQuote(quote));
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAnyPermission([PERMISSIONS.quotesUpdate]);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await prisma.quote.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!existing) return NextResponse.json({ message: "Quote not found" }, { status: 404 });
  if (!canAccessQuote(auth.user, existing.branchId)) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }
  if (existing.status === QuoteStatus.CONVERTED) {
    return NextResponse.json({ message: "Converted quotes cannot be edited" }, { status: 409 });
  }

  const parsed = quoteUpdateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
  }
  const payload = parsed.data;

  const nextStatus = payload.status ?? existing.status;
  if (payload.status && !canTransitionQuoteStatus(existing.status, payload.status)) {
    return NextResponse.json(
      { message: `Invalid status transition from ${existing.status} to ${payload.status}` },
      { status: 409 },
    );
  }

  const items = payload.items ? normalizeQuoteItems(payload.items) : null;
  const totals = items ? computeQuoteTotals(items) : { subtotal: Number(existing.subtotal), total: Number(existing.total) };
  const effectiveBranchId =
    payload.branchId === undefined
      ? existing.branchId
      : payload.branchId === null
        ? null
        : branchScope(auth.user, payload.branchId, PERMISSIONS.quotesCrossBranch);

  const transitioningToSent =
    payload.status === QuoteStatus.SENT && existing.status !== QuoteStatus.SENT;
  const sentAtForSchedule = new Date();

  const quote = await prisma.$transaction(async (tx) => {
    if (items) {
      await tx.quoteItem.deleteMany({ where: { quoteId: existing.id } });
    }

    const updated = await tx.quote.update({
      where: { id: existing.id },
      data: {
        title: payload.title ?? undefined,
        branchId: effectiveBranchId,
        customerId: payload.customerId === undefined ? undefined : payload.customerId,
        clientName: payload.clientName === undefined ? undefined : payload.clientName,
        clientPhone: payload.clientPhone === undefined ? undefined : payload.clientPhone,
        notes: payload.notes === undefined ? undefined : payload.notes,
        validUntil:
          payload.validUntil === undefined
            ? undefined
            : payload.validUntil === null
              ? null
              : new Date(payload.validUntil),
        subtotal: totals.subtotal,
        total: totals.total,
        status: nextStatus,
        ...(transitioningToSent
          ? {
              sentAt: sentAtForSchedule,
              nextReminderAt: computeInitialNextReminderAt(sentAtForSchedule),
            }
          : {}),
        statusChangedAt: payload.status ? new Date() : undefined,
        statusChangedById: payload.status ? auth.user.id : undefined,
        rejectedAt: payload.status === QuoteStatus.REJECTED ? new Date() : undefined,
        items: items
          ? {
              create: items.map((item, index) => ({
                ...item,
                position: index,
              })),
            }
          : undefined,
        statusHistory: payload.status
          ? {
              create: {
                fromStatus: existing.status,
                toStatus: payload.status,
                reason: "Updated from quote editor",
                changedById: auth.user.id,
              },
            }
          : undefined,
      },
      include: quoteInclude(),
    });
    return updated;
  });

  return NextResponse.json(serializeQuote(quote));
}
