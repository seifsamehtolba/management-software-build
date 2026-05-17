import { describe, expect, it } from "vitest";
import { planCostConsumption } from "./inventoryCosting";

describe("planCostConsumption", () => {
  it("consumes layers in FIFO order", () => {
    const plan = planCostConsumption(
      [
        { id: "layer-2", remainingQty: 3, unitCost: 12, receivedAt: "2026-02-01T00:00:00.000Z" },
        { id: "layer-1", remainingQty: 5, unitCost: 10, receivedAt: "2026-01-01T00:00:00.000Z" },
      ],
      6,
    );

    expect(plan).toEqual([
      { layerId: "layer-1", quantity: 5, unitCost: 10, totalCost: 50 },
      { layerId: "layer-2", quantity: 1, unitCost: 12, totalCost: 12 },
    ]);
  });

  it("stops once the requested quantity is covered", () => {
    const plan = planCostConsumption(
      [
        { id: "layer-1", remainingQty: 8, unitCost: 9.5, receivedAt: "2026-01-01T00:00:00.000Z" },
        { id: "layer-2", remainingQty: 4, unitCost: 11, receivedAt: "2026-02-01T00:00:00.000Z" },
      ],
      3,
    );

    expect(plan).toEqual([{ layerId: "layer-1", quantity: 3, unitCost: 9.5, totalCost: 28.5 }]);
  });
});
