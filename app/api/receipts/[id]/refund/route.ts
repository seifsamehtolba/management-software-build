import { NextRequest, NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { logActivity } from "@/lib/activity";
import { restockSaleItemCost } from "@/lib/inventoryCosting";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireApiAnyPermission([PERMISSIONS.salesRefundsManage]);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = (await req.json()) as {
    reason?: string;
    settlementMethod?: "CASH" | "CARD" | "STORE_CREDIT" | "BANK_TRANSFER" | "FAWRY" | "VODAFONE_CASH";
    refundMode?: "STANDARD" | "EXCHANGE";
    replacementSaleId?: string;
    replacementInvoiceNumber?: string;
    items?: Array<{
      saleItemId?: string;
      quantity?: number;
      amount?: number;
      restock?: boolean;
      locationId?: string;
    }>;
  };

  const reason = body.reason?.trim();
  const settlementMethod = body.settlementMethod?.trim() || "CASH";
  const refundMode = body.refundMode === "EXCHANGE" ? "EXCHANGE" : "STANDARD";
  const items = Array.isArray(body.items) ? body.items : [];
  if (!reason || items.length === 0) {
    return NextResponse.json({ message: "reason and refund items are required" }, { status: 400 });
  }

  let replacementSaleId = body.replacementSaleId?.trim() || null;
  if (!replacementSaleId && body.replacementInvoiceNumber?.trim()) {
    const replacementSale = await prisma.sale.findUnique({
      where: { invoiceNumber: body.replacementInvoiceNumber.trim() },
      select: { id: true },
    });
    replacementSaleId = replacementSale?.id ?? null;
  }

  const sale = await prisma.sale.findUnique({
    where: { id },
    select: {
      id: true,
      invoiceNumber: true,
      status: true,
      cashier: {
        select: {
          branchId: true,
        },
      },
      customer: {
        select: {
          id: true,
        },
      },
      items: {
        select: {
          id: true,
          productId: true,
          quantity: true,
          total: true,
          refundedQty: true,
        },
      },
    },
  });

  if (!sale) {
    return NextResponse.json({ message: "Receipt not found" }, { status: 404 });
  }

  if (sale.status !== "COMPLETED") {
    return NextResponse.json({ message: "Only completed sales can be refunded" }, { status: 400 });
  }
  if (refundMode === "EXCHANGE" && !replacementSaleId && settlementMethod !== "STORE_CREDIT") {
    return NextResponse.json(
      { message: "Exchanges need either store credit settlement or a replacement sale reference" },
      { status: 400 },
    );
  }
  if (settlementMethod === "STORE_CREDIT" && !sale.customer?.id) {
    return NextResponse.json({ message: "Store-credit refunds require a customer on the original sale" }, { status: 400 });
  }

  const result = await prisma.$transaction(async (tx) => {
    let totalAmount = 0;
    const prepared = [];

    for (const item of items) {
      const saleItemId = item.saleItemId?.trim();
      const quantity = Math.trunc(Number(item.quantity));
      if (!saleItemId || !Number.isInteger(quantity) || quantity <= 0) {
        return { ok: false as const, message: "Each refund item requires a valid saleItemId and positive quantity" };
      }

      const saleItem = sale.items.find((entry) => entry.id === saleItemId);
      if (!saleItem) {
        return { ok: false as const, message: "Refund item does not belong to this receipt" };
      }

      const refundableQty = saleItem.quantity - saleItem.refundedQty;
      if (quantity > refundableQty) {
        return { ok: false as const, message: "Refund quantity exceeds remaining refundable quantity" };
      }

      const defaultAmount = roundMoney((Number(saleItem.total) / saleItem.quantity) * quantity);
      const amount = item.amount === undefined ? defaultAmount : roundMoney(Number(item.amount));
      if (!Number.isFinite(amount) || amount < 0) {
        return { ok: false as const, message: "Refund amount must be a valid positive number" };
      }

      const restock = Boolean(item.restock);
      const locationId = item.locationId?.trim() || null;
      if (restock && !locationId) {
        return { ok: false as const, message: "A restocked refund item requires a locationId" };
      }

      prepared.push({
        saleItem,
        quantity,
        amount,
        restock,
        locationId,
      });
      totalAmount += amount;
    }

    const refund = await tx.refund.create({
      data: {
        saleId: sale.id,
        amount: totalAmount,
        reason,
        settlementMethod: settlementMethod as never,
        refundMode,
        replacementSaleId,
        exchangeReference: refundMode === "EXCHANGE" ? `EX-${sale.invoiceNumber}-${Date.now()}` : null,
        storeCreditIssued: settlementMethod === "STORE_CREDIT" ? totalAmount : 0,
        userId: auth.user.id,
      },
    });

    for (const item of prepared) {
      const refundItem = await tx.refundItem.create({
        data: {
          refundId: refund.id,
          saleItemId: item.saleItem.id,
          productId: item.saleItem.productId,
          quantity: item.quantity,
          amount: item.amount,
          restocked: item.restock,
          locationId: item.locationId,
        },
      });

      if (item.restock && item.locationId) {
        const existingStock = await tx.stockLevel.findFirst({
          where: {
            productId: item.saleItem.productId,
            locationId: item.locationId,
          },
          select: { id: true, quantity: true },
        });

        const previousQty = existingStock?.quantity ?? 0;
        const newQty = previousQty + item.quantity;

        if (existingStock) {
          await tx.stockLevel.update({
            where: { id: existingStock.id },
            data: { quantity: newQty },
          });
        } else {
          await tx.stockLevel.create({
            data: {
              productId: item.saleItem.productId,
              locationId: item.locationId,
              quantity: newQty,
            },
          });
        }

        const stockMovement = await tx.stockMovement.create({
          data: {
            productId: item.saleItem.productId,
            locationId: item.locationId,
            type: "RETURN",
            quantity: item.quantity,
            previousQty,
            newQty,
            reason: `Refund ${refund.id}`,
            referenceId: refund.id,
            userId: auth.user.id,
          },
        });

        await restockSaleItemCost(tx, {
          refundItemId: refundItem.id,
          saleItemId: item.saleItem.id,
          quantity: item.quantity,
          stockMovementId: stockMovement.id,
        });
      } else {
        await tx.saleItem.update({
          where: { id: item.saleItem.id },
          data: {
            refundedQty: {
              increment: item.quantity,
            },
          },
        });
      }
    }

    if (settlementMethod === "STORE_CREDIT" && sale.customer?.id) {
      await tx.customer.update({
        where: { id: sale.customer.id },
        data: {
          creditBalance: {
            increment: totalAmount,
          },
        },
      });
    }

    if (settlementMethod === "CASH" && sale.cashier.branchId) {
      const shift = await tx.cashShift.findFirst({
        where: {
          userId: auth.user.id,
          branchId: sale.cashier.branchId,
          status: "OPEN",
        },
        select: { id: true, expectedCash: true },
      });
      if (shift) {
        await tx.cashShiftEntry.create({
          data: {
            shiftId: shift.id,
            userId: auth.user.id,
            type: "REFUND_CASH",
            amount: totalAmount,
            refundId: refund.id,
            note: `Refund ${refund.id}`,
          },
        });
        await tx.cashShift.update({
          where: { id: shift.id },
          data: {
            expectedCash: {
              decrement: totalAmount,
            },
          },
        });
      }
    }

    return { ok: true as const, refundId: refund.id, amount: roundMoney(totalAmount) };
  });

  if (!result.ok) {
    return NextResponse.json({ message: result.message }, { status: 400 });
  }

  await logActivity({
    userId: auth.user.id,
    action: refundMode === "EXCHANGE" ? "SALE_EXCHANGE_CREATED" : "SALE_REFUND_CREATED",
    tableName: "Refund",
    recordId: result.refundId,
    details: {
      saleId: id,
      amount: result.amount,
      settlementMethod,
      replacementSaleId,
    },
  });

  return NextResponse.json(result);
}
