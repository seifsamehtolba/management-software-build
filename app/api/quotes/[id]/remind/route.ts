import { QuoteStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  buildWhatsAppReminderHref,
  canAccessBranchScope,
  computeNextReminderAfterTouch,
  quoteInclude,
  serializeQuote,
} from "@/lib/quotes";

function canAccessQuote(auth: { permissions: string[]; branchId: string | null }, quoteBranchId: string | null) {
  return canAccessBranchScope(auth, quoteBranchId, PERMISSIONS.quotesCrossBranch);
}

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAnyPermission([PERMISSIONS.quotesRemind]);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await prisma.quote.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ message: "Quote not found" }, { status: 404 });
  if (!canAccessQuote(auth.user, existing.branchId)) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }
  if (existing.status !== QuoteStatus.SENT) {
    return NextResponse.json({ message: "Only sent quotes can receive follow-up reminders" }, { status: 409 });
  }
  if (!existing.sentAt) {
    return NextResponse.json({ message: "Quote has no sentAt timestamp" }, { status: 409 });
  }

  const now = new Date();
  const updated = await prisma.quote.update({
    where: { id },
    data: {
      reminderCount: { increment: 1 },
      lastReminderAt: now,
      nextReminderAt: computeNextReminderAfterTouch(now),
      statusChangedAt: now,
      statusChangedById: auth.user.id,
      statusHistory: {
        create: {
          fromStatus: existing.status,
          toStatus: existing.status,
          reason: "Manual follow-up reminder",
          changedById: auth.user.id,
        },
      },
    },
    include: quoteInclude(),
  });

  const total = Number(updated.total);
  return NextResponse.json({
    quote: serializeQuote(updated),
    message: `Follow-up for ${updated.quoteNumber}`,
    whatsAppHref: buildWhatsAppReminderHref({
      clientPhone: updated.clientPhone,
      quoteNumber: updated.quoteNumber,
      title: updated.title,
      total,
      clientName: updated.clientName,
      validUntil: updated.validUntil,
    }),
  });
}
