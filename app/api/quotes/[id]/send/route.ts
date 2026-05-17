import { QuoteStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  canAccessBranchScope,
  canTransitionQuoteStatus,
  computeInitialNextReminderAt,
  quoteInclude,
  serializeQuote,
} from "@/lib/quotes";

function canAccessQuote(auth: { permissions: string[]; branchId: string | null }, quoteBranchId: string | null) {
  return canAccessBranchScope(auth, quoteBranchId, PERMISSIONS.quotesCrossBranch);
}

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAnyPermission([PERMISSIONS.quotesSend]);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await prisma.quote.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ message: "Quote not found" }, { status: 404 });
  if (!canAccessQuote(auth.user, existing.branchId)) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }
  if (!canTransitionQuoteStatus(existing.status, QuoteStatus.SENT)) {
    return NextResponse.json({ message: `Cannot send quote from ${existing.status}` }, { status: 409 });
  }

  const sentAt = new Date();
  const quote = await prisma.quote.update({
    where: { id },
    data: {
      status: QuoteStatus.SENT,
      sentAt,
      nextReminderAt: computeInitialNextReminderAt(sentAt),
      statusChangedAt: new Date(),
      statusChangedById: auth.user.id,
      statusHistory: {
        create: {
          fromStatus: existing.status,
          toStatus: QuoteStatus.SENT,
          reason: "Quote marked as sent",
          changedById: auth.user.id,
        },
      },
    },
    include: quoteInclude(),
  });

  return NextResponse.json(serializeQuote(quote));
}
