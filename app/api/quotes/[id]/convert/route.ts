import { QuoteStatus, SaleStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { canAccessBranchScope } from "@/lib/quotes";

function canAccessQuote(auth: { permissions: string[]; branchId: string | null }, quoteBranchId: string | null) {
  return canAccessBranchScope(auth, quoteBranchId, PERMISSIONS.quotesCrossBranch);
}

function buildInvoiceNumber(now = new Date()) {
  const datePart = now.toISOString().slice(0, 10).replaceAll("-", "");
  const randomPart = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, "0");
  return `INV-${datePart}-${randomPart}`;
}

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAnyPermission([PERMISSIONS.quotesConvert]);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await prisma.quote.findUnique({
    where: { id },
    include: {
      items: {
        orderBy: { position: "asc" },
      },
    },
  });
  if (!existing) return NextResponse.json({ message: "Quote not found" }, { status: 404 });
  if (!canAccessQuote(auth.user, existing.branchId)) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }
  if (existing.status !== QuoteStatus.APPROVED) {
    return NextResponse.json({ message: "Only approved quotes can be converted" }, { status: 409 });
  }
  if (existing.convertedSaleId) {
    return NextResponse.json({ message: "Quote already converted", saleId: existing.convertedSaleId }, { status: 409 });
  }

  const missingProductRows = existing.items.filter((item) => item.description.trim() && !item.productId);
  if (missingProductRows.length > 0) {
    return NextResponse.json(
      { message: "Every non-empty quote line must map to an inventory product before conversion" },
      { status: 400 },
    );
  }

  const converted = await prisma.$transaction(async (tx) => {
    const sale = await tx.sale.create({
      data: {
        invoiceNumber: buildInvoiceNumber(),
        customerId: existing.customerId,
        cashierId: auth.user.id,
        subtotal: existing.subtotal,
        discountAmount: 0,
        taxAmount: 0,
        total: existing.total,
        status: SaleStatus.QUOTE,
        notes: `Converted from quote ${existing.quoteNumber}`,
      },
    });

    if (existing.items.length > 0) {
      await tx.saleItem.createMany({
        data: existing.items
          .filter((item) => item.productId)
          .map((item) => ({
            saleId: sale.id,
            productId: item.productId!,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discount: 0,
            taxRate: 0,
            total: item.lineTotal,
          })),
      });
    }

    const quote = await tx.quote.update({
      where: { id: existing.id },
      data: {
        status: QuoteStatus.CONVERTED,
        convertedAt: new Date(),
        convertedSaleId: sale.id,
        statusChangedAt: new Date(),
        statusChangedById: auth.user.id,
        statusHistory: {
          create: {
            fromStatus: QuoteStatus.APPROVED,
            toStatus: QuoteStatus.CONVERTED,
            reason: `Converted to sale ${sale.invoiceNumber}`,
            changedById: auth.user.id,
          },
        },
      },
      include: {
        items: {
          orderBy: { position: "asc" },
        },
      },
    });

    return {
      quote: {
        ...quote,
        subtotal: Number(quote.subtotal),
        total: Number(quote.total),
        items: quote.items.map((item) => ({
          ...item,
          unitPrice: Number(item.unitPrice),
          lineTotal: Number(item.lineTotal),
        })),
      },
      sale: {
        ...sale,
        subtotal: Number(sale.subtotal),
        discountAmount: Number(sale.discountAmount),
        taxAmount: Number(sale.taxAmount),
        total: Number(sale.total),
      },
    };
  });

  return NextResponse.json(converted);
}
