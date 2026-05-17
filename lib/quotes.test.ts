import { QuoteStatus, type Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  buildQuotesListWhere,
  buildWhatsAppReminderHref,
  canTransitionQuoteStatus,
  computeInitialNextReminderAt,
  computeNextReminderAfterTouch,
  computeQuoteTotals,
  isFollowUpDueBucket,
  isFollowUpOverdueBucket,
  isQuoteValidityPast,
  isRecentlySent,
  isReminderDue,
  isReminderEligible,
  normalizeQuoteItems,
  shouldAutoExpireQuote,
  QUOTE_FIRST_REMINDER_AFTER_SENT_MS,
  QUOTE_REMINDER_INTERVAL_MS,
} from "./quotes";

describe("quote workflow helpers", () => {
  it("computes line totals and overall totals", () => {
    const items = normalizeQuoteItems([
      {
        categoryKey: "CPU",
        categoryLabel: "CPU",
        description: "Ryzen 5",
        quantity: 2,
        unitPrice: 1000,
        position: 0,
      },
      {
        categoryKey: "GPU",
        categoryLabel: "Graphic Card",
        description: "RTX 4070",
        quantity: 1,
        unitPrice: 25000,
        position: 1,
      },
    ]);
    const totals = computeQuoteTotals(items);
    expect(items[0].lineTotal).toBe(2000);
    expect(items[1].lineTotal).toBe(25000);
    expect(totals.subtotal).toBe(27000);
    expect(totals.total).toBe(27000);
  });

  it("enforces key status transitions", () => {
    expect(canTransitionQuoteStatus("DRAFT", "SENT")).toBe(true);
    expect(canTransitionQuoteStatus("SENT", "APPROVED")).toBe(true);
    expect(canTransitionQuoteStatus("APPROVED", "CONVERTED")).toBe(true);
    expect(canTransitionQuoteStatus("DRAFT", "APPROVED")).toBe(false);
    expect(canTransitionQuoteStatus("CONVERTED", "DRAFT")).toBe(false);
  });
});

describe("quote follow-up helpers", () => {
  const baseShape = {
    status: "SENT" as const,
    sentAt: new Date("2026-05-01T12:00:00.000Z"),
    validUntil: null as Date | null,
    lastReminderAt: null as Date | null,
    nextReminderAt: null as Date | null,
    reminderCount: 0,
  };

  it("shouldAutoExpireQuote for SENT/APPROVED past validUntil", () => {
    const past = new Date("2026-05-01T00:00:00.000Z");
    const now = new Date("2026-05-02T00:00:00.000Z");
    expect(shouldAutoExpireQuote({ status: "SENT", validUntil: past }, now)).toBe(true);
    expect(shouldAutoExpireQuote({ status: "APPROVED", validUntil: past }, now)).toBe(true);
    expect(shouldAutoExpireQuote({ status: "DRAFT", validUntil: past }, now)).toBe(false);
    expect(shouldAutoExpireQuote({ status: "SENT", validUntil: new Date("2026-06-01T00:00:00.000Z") }, now)).toBe(false);
  });

  it("isQuoteValidityPast uses strict before now", () => {
    const now = new Date("2026-05-04T12:00:00.000Z");
    expect(isQuoteValidityPast({ validUntil: new Date("2026-05-04T11:59:59.000Z") }, now)).toBe(true);
    expect(isQuoteValidityPast({ validUntil: new Date("2026-05-04T12:00:01.000Z") }, now)).toBe(false);
  });

  it("isReminderEligible only for SENT within validity", () => {
    const now = new Date("2026-05-04T12:00:00.000Z");
    expect(
      isReminderEligible(
        { status: "SENT", sentAt: new Date("2026-05-01T00:00:00.000Z"), validUntil: new Date("2026-06-01T00:00:00.000Z") },
        now,
      ),
    ).toBe(true);
    expect(
      isReminderEligible(
        { status: "SENT", sentAt: new Date("2026-05-01T00:00:00.000Z"), validUntil: new Date("2026-05-01T00:00:00.000Z") },
        now,
      ),
    ).toBe(false);
    expect(isReminderEligible({ status: "DRAFT", sentAt: new Date(), validUntil: null }, now)).toBe(false);
  });

  it("isReminderDue respects first delay then interval", () => {
    const sentAt = new Date("2026-05-01T12:00:00.000Z");
    const tooSoon = new Date(sentAt.getTime() + QUOTE_FIRST_REMINDER_AFTER_SENT_MS - 60_000);
    expect(isReminderDue({ ...baseShape, sentAt, reminderCount: 0 }, tooSoon)).toBe(false);

    const firstDue = new Date(sentAt.getTime() + QUOTE_FIRST_REMINDER_AFTER_SENT_MS);
    expect(isReminderDue({ ...baseShape, sentAt, reminderCount: 0 }, firstDue)).toBe(true);

    const last = new Date("2026-05-05T12:00:00.000Z");
    expect(
      isReminderDue(
        {
          ...baseShape,
          sentAt,
          reminderCount: 1,
          lastReminderAt: last,
          nextReminderAt: new Date(last.getTime() + QUOTE_REMINDER_INTERVAL_MS),
        },
        new Date(last.getTime() + QUOTE_REMINDER_INTERVAL_MS - 60_000),
      ),
    ).toBe(false);
    expect(
      isReminderDue(
        {
          ...baseShape,
          sentAt,
          reminderCount: 1,
          lastReminderAt: last,
          nextReminderAt: new Date(last.getTime() + QUOTE_REMINDER_INTERVAL_MS),
        },
        new Date(last.getTime() + QUOTE_REMINDER_INTERVAL_MS),
      ),
    ).toBe(true);
  });

  it("isFollowUpOverdueBucket for SENT past validity", () => {
    const now = new Date("2026-05-10T00:00:00.000Z");
    expect(
      isFollowUpOverdueBucket(
        { ...baseShape, validUntil: new Date("2026-05-09T00:00:00.000Z") },
        now,
      ),
    ).toBe(true);
  });

  it("computeInitialNextReminderAt and computeNextReminderAfterTouch", () => {
    const sentAt = new Date("2026-05-01T12:00:00.000Z");
    const initial = computeInitialNextReminderAt(sentAt);
    expect(initial.getTime()).toBe(sentAt.getTime() + QUOTE_FIRST_REMINDER_AFTER_SENT_MS);

    const touch = new Date("2026-05-05T10:00:00.000Z");
    const next = computeNextReminderAfterTouch(touch);
    expect(next.getTime()).toBe(touch.getTime() + QUOTE_REMINDER_INTERVAL_MS);
  });

  it("isRecentlySent within 7 days", () => {
    const now = new Date("2026-05-04T12:00:00.000Z");
    expect(isRecentlySent({ ...baseShape, sentAt: new Date("2026-05-01T12:00:00.000Z") }, now)).toBe(true);
    expect(isRecentlySent({ ...baseShape, sentAt: new Date("2026-04-01T12:00:00.000Z") }, now)).toBe(false);
  });

  it("isFollowUpDueBucket includes reminder due or expiring soon", () => {
    const now = new Date("2026-05-04T12:00:00.000Z");
    const sentLongAgo = new Date(now.getTime() - QUOTE_FIRST_REMINDER_AFTER_SENT_MS - 1000);
    expect(isFollowUpDueBucket({ ...baseShape, sentAt: sentLongAgo, validUntil: new Date("2026-06-01T00:00:00.000Z") }, now)).toBe(
      true,
    );

    const validSoon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    expect(
      isFollowUpDueBucket(
        { ...baseShape, sentAt: new Date(now.getTime() - 1000), validUntil: validSoon, reminderCount: 0 },
        now,
      ),
    ).toBe(true);
  });

  it("buildWhatsAppReminderHref uses client phone when present", () => {
    const href = buildWhatsAppReminderHref({
      clientPhone: "+201234567890",
      quoteNumber: "Q-1",
      title: "PC Build",
      total: 15000,
      clientName: "Ali",
      validUntil: new Date("2026-06-01T00:00:00.000Z"),
    });
    expect(href).toContain("wa.me/");
    expect(href).toContain("201234567890");
  });

  it("buildQuotesListWhere applies follow-up and search filters", () => {
    const now = new Date("2026-05-10T12:00:00.000Z");
    const overdue = buildQuotesListWhere({
      effectiveBranchId: null,
      status: null,
      q: "",
      followUp: "overdue",
      now,
    });
    const overdueAnd = overdue.AND as Prisma.QuoteWhereInput[];
    expect(overdueAnd).toHaveLength(2);
    expect(overdueAnd[0]).toEqual({ status: QuoteStatus.SENT });

    const withStatus = buildQuotesListWhere({
      effectiveBranchId: "b1",
      status: QuoteStatus.DRAFT,
      q: "",
      followUp: "",
      now,
    });
    const statusAnd = withStatus.AND as Prisma.QuoteWhereInput[];
    expect(statusAnd).toEqual([{ branchId: "b1" }, { status: QuoteStatus.DRAFT }]);

    const withQ = buildQuotesListWhere({
      effectiveBranchId: null,
      status: null,
      q: "acme",
      followUp: "",
      now,
    });
    const qAnd = withQ.AND as Prisma.QuoteWhereInput[];
    expect(qAnd[0]).toMatchObject({
      OR: expect.arrayContaining([{ quoteNumber: { contains: "acme" } }]),
    });
  });
});
