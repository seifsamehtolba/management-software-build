export type PaymentSplitMath = { amount: number };

export function calculateCartTotal(lines: Array<{ quantity: number; unitPrice: number }>) {
  return Number(lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0).toFixed(2));
}

export function calculatePointsDiscount(total: number, redeemPoints: number, availablePoints: number) {
  const cappedRequested = Math.max(0, Math.floor(redeemPoints));
  const maxAllowedByBalance = Math.min(cappedRequested, Math.max(0, Math.floor(availablePoints)));
  return Math.min(maxAllowedByBalance, total);
}

export function calculateRemainingAmount(finalTotal: number, splits: PaymentSplitMath[]) {
  const paymentTotal = splits.reduce((sum, split) => sum + (Number.isFinite(split.amount) ? split.amount : 0), 0);
  return Number((finalTotal - paymentTotal).toFixed(2));
}
