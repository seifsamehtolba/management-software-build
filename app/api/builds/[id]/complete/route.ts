import { NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { logActivity } from "@/lib/activity";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

function invoiceNumber() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const rand = Math.floor(10000 + Math.random() * 90000);
  return `INV-${yy}${mm}-${rand}`;
}

export async function POST(_req: Request, { params }: Params) {
  const auth = await requireApiAnyPermission([PERMISSIONS.buildsUpdate]);
  if (!auth.ok) return auth.response;

  const { id } = await params;

  const result = await prisma.$transaction(async (tx) => {
    const build = await tx.buildOrder.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true } },
        parts: {
          include: {
            product: { select: { id: true, sellPrice: true, taxRate: true, costPrice: true } },
          },
        },
      },
    });

    if (!build) return { ok: false as const, message: "Build order not found" };
    if (build.status === "DELIVERED") return { ok: false as const, message: "Already delivered" };
    if (build.convertedSaleId) return { ok: false as const, message: "Already converted to sale" };

    const invNum = invoiceNumber();
    let subtotal = 0;
    let taxAmount = 0;

    const saleItems = build.parts.map((part) => {
      const unitPrice = Number(part.product.sellPrice);
      const taxRate = Number(part.product.taxRate);
      const lineTotal = unitPrice * part.quantity;
      const lineTax = lineTotal * taxRate;
      subtotal += lineTotal;
      taxAmount += lineTax;
      return {
        productId: part.productId,
        quantity: part.quantity,
        unitPrice,
        discount: 0,
        taxRate,
        total: lineTotal,
      };
    });

    // Add labor cost as a line item if set
    const laborCost = Number(build.laborCost ?? 0);
    if (laborCost > 0) {
      subtotal += laborCost;
    }

    const total = subtotal + taxAmount;

    const sale = await tx.sale.create({
      data: {
        invoiceNumber: invNum,
        customerId: build.customer.id,
        cashierId: auth.user.id,
        subtotal,
        taxAmount,
        total,
        status: "COMPLETED",
        notes: `Build Order: ${build.buildNumber} — ${build.title}`,
        items: { create: saleItems },
        payments: {
          create: [{ method: "STORE_CREDIT", amount: total }],
        },
      },
    });

    await tx.buildOrder.update({
      where: { id },
      data: {
        status: "READY",
        convertedSaleId: sale.id,
        finalCost: total,
      },
    });

    return { ok: true as const, saleId: sale.id, invoiceNumber: invNum, total };
  });

  if (!result.ok) {
    return NextResponse.json({ message: result.message }, { status: 400 });
  }

  await logActivity({
    userId: auth.user.id,
    action: "BUILD_COMPLETED",
    tableName: "BuildOrder",
    recordId: id,
    details: { invoiceNumber: result.invoiceNumber, total: result.total },
  });

  return NextResponse.json(result);
}
