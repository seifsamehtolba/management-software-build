import { QuoteStatus, type Prisma } from "@prisma/client";
import { z } from "zod";
import { hasPermission, PERMISSIONS, type PermissionKey } from "./permissions";
const quoteStatusValues = ["DRAFT", "SENT", "APPROVED", "REJECTED", "EXPIRED", "CONVERTED"] as const;

export const quoteItemInputSchema = z.object({
  categoryKey: z.string().trim().min(1).max(60),
  categoryLabel: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(""),
  quantity: z.coerce.number().int().min(1).max(10000).default(1),
  unitPrice: z.coerce.number().min(0).max(100_000_000).default(0),
  productId: z.string().trim().min(1).optional(),
  position: z.coerce.number().int().min(0).max(500).default(0),
});

export const quoteCreateSchema = z.object({
  title: z.string().trim().min(1).max(120).default("Price Quote"),
  branchId: z.string().trim().min(1).optional(),
  customerId: z.string().trim().min(1).optional(),
  clientName: z.string().trim().max(120).optional(),
  clientPhone: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(2000).optional(),
  validUntil: z.string().datetime().optional(),
  items: z.array(quoteItemInputSchema).min(1).max(100),
});

export const quoteUpdateSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  branchId: z.string().trim().min(1).nullable().optional(),
  customerId: z.string().trim().min(1).nullable().optional(),
  clientName: z.string().trim().max(120).nullable().optional(),
  clientPhone: z.string().trim().max(40).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  validUntil: z.string().datetime().nullable().optional(),
  status: z.enum(quoteStatusValues).optional(),
  items: z.array(quoteItemInputSchema).min(1).max(100).optional(),
});

export type QuoteItemInput = z.infer<typeof quoteItemInputSchema>;
export type QuoteCreateInput = z.infer<typeof quoteCreateSchema>;
export type QuoteUpdateInput = z.infer<typeof quoteUpdateSchema>;

export function buildQuoteNumber(now = new Date()) {
  const datePart = now.toISOString().slice(0, 10).replaceAll("-", "");
  const randomPart = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, "0");
  return `Q-${datePart}-${randomPart}`;
}

export function normalizeQuoteItems(items: QuoteItemInput[]) {
  return items.map((item, index) => {
    const quantity = Number(item.quantity) || 1;
    const unitPrice = Number(item.unitPrice) || 0;
    const lineTotal = Number((quantity * unitPrice).toFixed(2));
    return {
      categoryKey: item.categoryKey.trim(),
      categoryLabel: item.categoryLabel.trim(),
      description: item.description.trim(),
      quantity,
      unitPrice,
      lineTotal,
      productId: item.productId?.trim() || null,
      position: item.position ?? index,
    };
  });
}

export function computeQuoteTotals(items: Array<{ lineTotal: number }>) {
  const subtotal = Number(items.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2));
  return { subtotal, total: subtotal };
}

export function canTransitionQuoteStatus(from: QuoteStatus, to: QuoteStatus) {
  if (from === to) return true;
  const map: Record<QuoteStatus, QuoteStatus[]> = {
    DRAFT: ["SENT", "REJECTED", "EXPIRED"],
    SENT: ["APPROVED", "REJECTED", "EXPIRED"],
    APPROVED: ["CONVERTED", "EXPIRED"],
    REJECTED: ["DRAFT"],
    EXPIRED: ["DRAFT"],
    CONVERTED: [],
  };
  return map[from].includes(to);
}

/** Time after `sentAt` before the first automated reminder becomes due. */
export const QUOTE_FIRST_REMINDER_AFTER_SENT_MS = 24 * 60 * 60 * 1000;

/** Minimum spacing between automated reminders. */
export const QUOTE_REMINDER_INTERVAL_MS = 48 * 60 * 60 * 1000;

/** Quotes with `sentAt` within this window count as "recently sent" for UI filters. */
export const QUOTE_RECENTLY_SENT_MS = 7 * 24 * 60 * 60 * 1000;

export type QuoteFollowUpShape = {
  status: QuoteStatus;
  sentAt: Date | string | null;
  validUntil: Date | string | null;
  lastReminderAt: Date | string | null;
  nextReminderAt: Date | string | null;
  reminderCount: number;
};

export function toQuoteDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  return value instanceof Date ? value : new Date(value);
}

/** `validUntil` is strictly before `now` (quote validity window has ended). */
export function isQuoteValidityPast(quote: Pick<QuoteFollowUpShape, "validUntil">, now: Date): boolean {
  const until = toQuoteDate(quote.validUntil);
  if (!until) return false;
  return until.getTime() < now.getTime();
}

/** Quotes that the expire job should move to EXPIRED (still active, past validity). */
export function shouldAutoExpireQuote(
  quote: Pick<QuoteFollowUpShape, "status" | "validUntil">,
  now: Date,
): boolean {
  if (quote.status !== "SENT" && quote.status !== "APPROVED") return false;
  return isQuoteValidityPast(quote, now);
}

/** SENT quotes that are still within validity (or have open-ended validity) and have been sent. */
export function isReminderEligible(
  quote: Pick<QuoteFollowUpShape, "status" | "sentAt" | "validUntil">,
  now: Date,
): boolean {
  if (quote.status !== "SENT") return false;
  const sentAt = toQuoteDate(quote.sentAt);
  if (!sentAt) return false;
  if (isQuoteValidityPast(quote, now)) return false;
  return true;
}

/** Next automated reminder slot after a reminder was recorded at `now`. */
export function computeNextReminderAfterTouch(now: Date): Date {
  return new Date(now.getTime() + QUOTE_REMINDER_INTERVAL_MS);
}

/** First scheduled reminder after send (do not fire before first delay). */
export function computeInitialNextReminderAt(sentAt: Date): Date {
  return new Date(sentAt.getTime() + QUOTE_FIRST_REMINDER_AFTER_SENT_MS);
}

/**
 * Whether an automated reminder run should include this quote (throttled, within validity).
 */
export function isReminderDue(quote: QuoteFollowUpShape, now: Date): boolean {
  if (!isReminderEligible(quote, now)) return false;
  const next = toQuoteDate(quote.nextReminderAt);
  if (next && next.getTime() > now.getTime()) return false;

  const sentAt = toQuoteDate(quote.sentAt);
  if (!sentAt) return false;

  if (quote.reminderCount === 0) {
    return now.getTime() - sentAt.getTime() >= QUOTE_FIRST_REMINDER_AFTER_SENT_MS;
  }

  const last = toQuoteDate(quote.lastReminderAt);
  if (!last) {
    return now.getTime() - sentAt.getTime() >= QUOTE_FIRST_REMINDER_AFTER_SENT_MS + QUOTE_REMINDER_INTERVAL_MS;
  }
  return now.getTime() - last.getTime() >= QUOTE_REMINDER_INTERVAL_MS;
}

/** SENT and past `validUntil` but not yet expired by job (urgency bucket). */
export function isFollowUpOverdueBucket(quote: QuoteFollowUpShape, now: Date): boolean {
  return quote.status === "SENT" && isQuoteValidityPast(quote, now);
}

/** Needs follow-up: reminder due, validity expiring within 48h, or overdue validity (still SENT). */
export function isFollowUpDueBucket(quote: QuoteFollowUpShape, now: Date): boolean {
  if (quote.status !== "SENT") return false;
  if (isReminderDue(quote, now)) return true;
  if (isFollowUpOverdueBucket(quote, now)) return true;
  const until = toQuoteDate(quote.validUntil);
  if (until && until.getTime() >= now.getTime()) {
    const msLeft = until.getTime() - now.getTime();
    if (msLeft <= 48 * 60 * 60 * 1000) return true;
  }
  return false;
}

export function isRecentlySent(quote: QuoteFollowUpShape, now: Date): boolean {
  if (quote.status !== "SENT") return false;
  const sentAt = toQuoteDate(quote.sentAt);
  if (!sentAt) return false;
  return now.getTime() - sentAt.getTime() <= QUOTE_RECENTLY_SENT_MS;
}

export function buildQuoteReminderMessage(quote: {
  quoteNumber: string;
  title: string;
  total: number;
  clientName?: string | null;
  validUntil?: Date | string | null;
}): string {
  const until = toQuoteDate(quote.validUntil ?? null);
  const untilLine = until ? `Valid until: ${until.toLocaleDateString()}\n` : "";
  return [
    `Hi${quote.clientName ? ` ${quote.clientName}` : ""},`,
    "",
    `Following up on ${quote.title} (${quote.quoteNumber}).`,
    `Total: EGP ${quote.total.toFixed(2)}`,
    untilLine,
    "Reply when you are ready to proceed or if you have questions.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildQuotesListWhere(input: {
  effectiveBranchId: string | null;
  status: QuoteStatus | null;
  q: string;
  followUp: string;
  now?: Date;
}): Prisma.QuoteWhereInput {
  const now = input.now ?? new Date();
  const followUp = input.followUp.trim().toLowerCase();
  const followUpFilters = ["due", "overdue", "recent", "all"];
  const useFollowUp = followUpFilters.includes(followUp) && followUp !== "all";

  const andParts: Prisma.QuoteWhereInput[] = [];

  if (input.effectiveBranchId) {
    andParts.push({ branchId: input.effectiveBranchId });
  }

  if (useFollowUp) {
    if (followUp === "overdue") {
      andParts.push({ status: QuoteStatus.SENT });
      andParts.push({ validUntil: { not: null, lt: now } });
    } else if (followUp === "due") {
      const firstDueSentAt = new Date(now.getTime() - QUOTE_FIRST_REMINDER_AFTER_SENT_MS);
      const expiringBefore = new Date(now.getTime() + 48 * 60 * 60 * 1000);
      andParts.push({ status: QuoteStatus.SENT });
      andParts.push({
        OR: [
          { nextReminderAt: { lte: now } },
          { AND: [{ reminderCount: 0 }, { sentAt: { lte: firstDueSentAt } }] },
          {
            AND: [{ validUntil: { not: null } }, { validUntil: { lte: expiringBefore } }, { validUntil: { gte: now } }],
          },
        ],
      });
    } else if (followUp === "recent") {
      andParts.push({ status: QuoteStatus.SENT });
      andParts.push({ sentAt: { gte: new Date(now.getTime() - QUOTE_RECENTLY_SENT_MS) } });
    }
  } else {
    if (input.status) {
      andParts.push({ status: input.status });
    }
  }

  const q = input.q.trim();
  if (q) {
    andParts.push({
      OR: [
        { quoteNumber: { contains: q } },
        { title: { contains: q } },
        { clientName: { contains: q } },
        { clientPhone: { contains: q } },
      ],
    });
  }

  return andParts.length > 0 ? { AND: andParts } : {};
}

export function buildWhatsAppReminderHref(quote: {
  clientPhone?: string | null;
  quoteNumber: string;
  title: string;
  total: number;
  clientName?: string | null;
  validUntil?: Date | string | null;
}): string {
  const text = buildQuoteReminderMessage(quote);
  const encoded = encodeURIComponent(text);
  const digits = (quote.clientPhone ?? "").replace(/\D/g, "");
  if (digits.length >= 8) {
    return `https://wa.me/${digits}?text=${encoded}`;
  }
  return `https://wa.me/?text=${encoded}`;
}

export function branchScope(
  auth: { permissions: string[]; branchId: string | null },
  requestedBranchId?: string | null,
  crossBranchPermission: PermissionKey = PERMISSIONS.quotesCrossBranch,
) {
  const canCrossBranch = hasPermission(auth.permissions, crossBranchPermission);
  return canCrossBranch ? requestedBranchId || null : auth.branchId;
}

export function canAccessBranchScope(
  auth: { permissions: string[]; branchId: string | null },
  targetBranchId: string | null,
  crossBranchPermission: PermissionKey = PERMISSIONS.quotesCrossBranch,
) {
  return (
    hasPermission(auth.permissions, crossBranchPermission) ||
    !targetBranchId ||
    auth.branchId === targetBranchId
  );
}

export function quoteInclude() {
  return {
    branch: { select: { id: true, name: true } },
    customer: { select: { id: true, name: true, phone: true } },
    createdBy: { select: { id: true, name: true } },
    statusChangedBy: { select: { id: true, name: true } },
    items: {
      orderBy: { position: "asc" as const },
      select: {
        id: true,
        categoryKey: true,
        categoryLabel: true,
        description: true,
        quantity: true,
        unitPrice: true,
        lineTotal: true,
        productId: true,
        position: true,
      },
    },
    statusHistory: {
      orderBy: { changedAt: "desc" as const },
      select: {
        id: true,
        fromStatus: true,
        toStatus: true,
        reason: true,
        changedAt: true,
        changedBy: { select: { id: true, name: true } },
      },
    },
  } satisfies Prisma.QuoteInclude;
}

export function serializeQuote(quote: {
  subtotal: Prisma.Decimal;
  total: Prisma.Decimal;
  items: Array<{ unitPrice: Prisma.Decimal; lineTotal: Prisma.Decimal }>;
  validUntil?: Date | null;
  sentAt?: Date | null;
  approvedAt?: Date | null;
  rejectedAt?: Date | null;
  convertedAt?: Date | null;
  lastReminderAt?: Date | null;
  nextReminderAt?: Date | null;
  reminderCount?: number;
}) {
  const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
  return {
    ...quote,
    subtotal: Number(quote.subtotal),
    total: Number(quote.total),
    validUntil: iso(quote.validUntil ?? null),
    sentAt: iso(quote.sentAt ?? null),
    approvedAt: iso(quote.approvedAt ?? null),
    rejectedAt: iso(quote.rejectedAt ?? null),
    convertedAt: iso(quote.convertedAt ?? null),
    lastReminderAt: iso(quote.lastReminderAt ?? null),
    nextReminderAt: iso(quote.nextReminderAt ?? null),
    reminderCount: quote.reminderCount ?? 0,
    items: quote.items.map((item) => ({
      ...item,
      unitPrice: Number(item.unitPrice),
      lineTotal: Number(item.lineTotal),
    })),
  };
}
