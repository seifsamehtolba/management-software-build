import { describe, expect, it } from "vitest";
import { calculateCartTotal, calculatePointsDiscount, calculateRemainingAmount } from "../lib/posMath";

describe("pos math", () => {
  it("calculates cart total", () => {
    const total = calculateCartTotal([
      { quantity: 2, unitPrice: 10 },
      { quantity: 1, unitPrice: 5.5 },
    ]);
    expect(total).toBe(25.5);
  });

  it("caps points discount by available and total", () => {
    expect(calculatePointsDiscount(100, 40, 30)).toBe(30);
    expect(calculatePointsDiscount(20, 100, 100)).toBe(20);
  });

  it("calculates remaining split amount", () => {
    const remaining = calculateRemainingAmount(100, [{ amount: 60 }, { amount: 15.5 }]);
    expect(remaining).toBe(24.5);
  });
});
