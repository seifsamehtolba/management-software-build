import { QuoteStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  branchScope,
  buildQuoteNumber,
  buildQuotesListWhere,
  computeQuoteTotals,
  normalizeQuoteItems,
  quoteCreateSchema,
  quoteInclude,
  serializeQuote,
} from "@/lib/quotes";

export async function GET(req: NextRequest) {
  const auth = await requireApiAnyPermission([PERMISSIONS.quotesRead]);
  if (!auth.ok) return auth.response;

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const statusParam = req.nextUrl.searchParams.get("status")?.trim() ?? "";
  const requestedBranchId = req.nextUrl.searchParams.get("branchId")?.trim() ?? "";
  const followUp = req.nextUrl.searchParams.get("followUp")?.trim().toLowerCase() ?? "";
  const effectiveBranchId = branchScope(auth.user, requestedBranchId, PERMISSIONS.quotesCrossBranch);
  const status = Object.values(QuoteStatus).includes(statusParam as QuoteStatus)
    ? (statusParam as QuoteStatus)
    : null;

  const where = buildQuotesListWhere({
    effectiveBranchId,
    status,
    q,
    followUp,
  });

  const quotes = await prisma.quote.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 120,
    include: quoteInclude(),
  });

  return NextResponse.json(quotes.map((quote) => serializeQuote(quote)));
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAnyPermission([PERMISSIONS.quotesCreate]);
  if (!auth.ok) return auth.response;

  const parsed = quoteCreateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
  }

  const effectiveBranchId = branchScope(auth.user, parsed.data.branchId ?? null, PERMISSIONS.quotesCrossBranch);
  const items = normalizeQuoteItems(parsed.data.items);
  const totals = computeQuoteTotals(items);
  const validUntil = parsed.data.validUntil ? new Date(parsed.data.validUntil) : null;

  if (parsed.data.customerId) {
    const customer = await prisma.customer.findUnique({ where: { id: parsed.data.customerId } });
    if (!customer) {
      return NextResponse.json({ message: "Customer not found" }, { status: 404 });
    }
  }

  const quote = await prisma.quote.create({
    data: {
      quoteNumber: buildQuoteNumber(),
      title: parsed.data.title,
      branchId: effectiveBranchId,
      customerId: parsed.data.customerId ?? null,
      clientName: parsed.data.clientName || null,
      clientPhone: parsed.data.clientPhone || null,
      notes: parsed.data.notes || null,
      validUntil,
      subtotal: totals.subtotal,
      total: totals.total,
      createdById: auth.user.id,
      statusChangedById: auth.user.id,
      statusChangedAt: new Date(),
      items: {
        create: items.map((item, index) => ({
          ...item,
          position: index,
        })),
      },
      statusHistory: {
        create: {
          fromStatus: null,
          toStatus: QuoteStatus.DRAFT,
          reason: "Quote created",
          changedById: auth.user.id,
        },
      },
    },
    include: quoteInclude(),
  });

  return NextResponse.json(serializeQuote(quote), { status: 201 });
}
