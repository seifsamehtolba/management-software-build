import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);

export const syncPayloadSchemas = {
  sales: z.object({
    invoiceNumber: nonEmptyString,
    cashierId: nonEmptyString,
    subtotal: z.coerce.number(),
    discountAmount: z.coerce.number().optional(),
    taxAmount: z.coerce.number(),
    total: z.coerce.number(),
    status: nonEmptyString,
    createdAt: nonEmptyString,
  }),
  sale_items: z.object({
    saleId: nonEmptyString,
    productId: nonEmptyString,
    quantity: z.coerce.number().int(),
    unitPrice: z.coerce.number(),
    discount: z.coerce.number().optional(),
    taxRate: z.coerce.number(),
    total: z.coerce.number(),
  }),
  payments: z.object({
    saleId: nonEmptyString,
    method: nonEmptyString,
    amount: z.coerce.number().min(0),
    createdAt: nonEmptyString,
    reference: z.string().optional(),
  }),
  customers: z.object({
    name: nonEmptyString,
    phone: nonEmptyString,
  }),
  stock_levels: z.object({
    productId: nonEmptyString,
    locationId: nonEmptyString,
    quantity: z.coerce.number().int(),
  }),
  stock_movements: z.object({
    productId: nonEmptyString,
    locationId: nonEmptyString,
    type: nonEmptyString,
    quantity: z.coerce.number().int(),
    previousQty: z.coerce.number().int(),
    newQty: z.coerce.number().int(),
    reason: z.string().optional(),
    referenceId: z.string().optional(),
    userId: nonEmptyString,
    createdAt: nonEmptyString,
  }),
  cash_shifts: z.object({
    branchId: nonEmptyString,
    userId: nonEmptyString,
    status: nonEmptyString,
    openedAt: nonEmptyString,
    openingCash: z.coerce.number().min(0),
    expectedCash: z.coerce.number(),
    variance: z.coerce.number().optional(),
    closedAt: z.string().optional(),
    countedCash: z.coerce.number().optional(),
    notes: z.string().optional(),
  }),
  cash_shift_entries: z.object({
    shiftId: nonEmptyString,
    branchId: nonEmptyString,
    userId: nonEmptyString,
    type: nonEmptyString,
    amount: z.coerce.number(),
    note: z.string().optional(),
    saleId: z.string().optional(),
    refundId: z.string().optional(),
    createdAt: nonEmptyString,
  }),
} as const;

export function validateSyncPayload(tableName: string, payload: Record<string, unknown>) {
  const schema = syncPayloadSchemas[tableName as keyof typeof syncPayloadSchemas];
  if (!schema) return { success: false as const, message: `Unsupported table: ${tableName}` };
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path?.join(".") || "payload";
    return {
      success: false as const,
      message: `Invalid ${tableName} payload at "${path}": ${issue?.message ?? "validation failed"}`,
    };
  }
  return { success: true as const };
}
