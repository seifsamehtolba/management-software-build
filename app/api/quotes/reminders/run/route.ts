import { QuoteStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  buildWhatsAppReminderHref,
  computeNextReminderAfterTouch,
  isReminderDue,
  quoteInclude,
  serializeQuote,
} from "@/lib/quotes";

export async function POST() {
  const auth = await requireApiAnyPermission([PERMISSIONS.quotesJobsRun]);
  if (!auth.ok) return auth.response;

  const now = new Date();
  const batch = await prisma.quote.findMany({
    where: {
      status: QuoteStatus.SENT,
      sentAt: { not: null },
    },
    orderBy: { updatedAt: "asc" },
    take: 100,
  });

  const due = batch.filter((row) =>
    isReminderDue(
      {
        status: row.status,
        sentAt: row.sentAt,
        validUntil: row.validUntil,
        lastReminderAt: row.lastReminderAt,
        nextReminderAt: row.nextReminderAt,
        reminderCount: row.reminderCount,
      },
      now,
    ),
  );

  const results: Array<{
    quote: ReturnType<typeof serializeQuote>;
    message: string;
    whatsAppHref: string;
  }> = [];

  for (const row of due) {
    const updated = await prisma.quote.update({
      where: { id: row.id },
      data: {
        reminderCount: { increment: 1 },
        lastReminderAt: now,
        nextReminderAt: computeNextReminderAfterTouch(now),
        statusChangedAt: now,
        statusChangedById: auth.user.id,
        statusHistory: {
          create: {
            fromStatus: row.status,
            toStatus: row.status,
            reason: "Automated follow-up reminder due",
            changedById: auth.user.id,
          },
        },
      },
      include: quoteInclude(),
    });

    const serialized = serializeQuote(updated);
    const total = Number(updated.total);
    results.push({
      quote: serialized,
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

  return NextResponse.json({
    scanned: batch.length,
    dueCount: due.length,
    reminders: results,
  });
}
