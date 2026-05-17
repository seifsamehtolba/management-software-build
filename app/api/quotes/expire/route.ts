import { QuoteStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { canTransitionQuoteStatus, shouldAutoExpireQuote } from "@/lib/quotes";

export async function POST() {
  const auth = await requireApiAnyPermission([PERMISSIONS.quotesJobsRun]);
  if (!auth.ok) return auth.response;

  const now = new Date();
  const candidates = await prisma.quote.findMany({
    where: {
      status: { in: [QuoteStatus.SENT, QuoteStatus.APPROVED] },
      validUntil: { not: null, lt: now },
    },
    select: { id: true, status: true, validUntil: true, quoteNumber: true },
    take: 200,
  });

  let scanned = 0;
  let expired = 0;

  for (const row of candidates) {
    scanned += 1;
    if (!shouldAutoExpireQuote(row, now)) continue;
    if (!canTransitionQuoteStatus(row.status, QuoteStatus.EXPIRED)) continue;

    await prisma.quote.update({
      where: { id: row.id },
      data: {
        status: QuoteStatus.EXPIRED,
        statusChangedAt: now,
        statusChangedById: auth.user.id,
        statusHistory: {
          create: {
            fromStatus: row.status,
            toStatus: QuoteStatus.EXPIRED,
            reason: `Quote auto-expired after validUntil (${row.quoteNumber})`,
            changedById: auth.user.id,
          },
        },
      },
    });
    expired += 1;
  }

  return NextResponse.json({ scanned, expired });
}
