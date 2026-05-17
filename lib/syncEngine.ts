import { db, type SyncQueueItem } from "@/lib/localDb";
import { parseResponseJson } from "@/lib/parseResponseJson";

const MAX_ATTEMPTS = 5;
const SYNC_INTERVAL_MS = 30_000;

type SyncApiResponse = {
  status: "synced" | "conflict" | "error";
  serverId?: string;
  serverRecord?: Record<string, unknown>;
  message?: string;
};

type UpdatableTable = {
  update: (key: string, changes: Record<string, unknown>) => Promise<unknown>;
};

class SyncEngine {
  private isFlushing = false;

  async flushQueue() {
    if (this.isFlushing || !navigator.onLine) return;
    this.isFlushing = true;

    try {
      const pending = await db.sync_queue
        .where("status")
        .anyOf(["pending", "failed"])
        .filter((item) => item.attempts < MAX_ATTEMPTS)
        .sortBy("createdAt");

      for (const item of pending) {
        await this.processItem(item);
      }
    } finally {
      this.isFlushing = false;
    }
  }

  private async processItem(item: SyncQueueItem) {
    await db.sync_queue.update(item.id!, {
      status: "syncing",
      lastAttemptAt: new Date().toISOString(),
    });

    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item),
      });
      const result = await parseResponseJson<SyncApiResponse>(res);
      if (!result) {
        throw new Error(`Sync failed (${res.status}): empty response`);
      }

      if (result.status === "synced") {
        await db.sync_queue.update(item.id!, { status: "synced" });
        const table = (db as unknown as Record<string, UpdatableTable | undefined>)[item.tableName];
        await table?.update(item.recordId, {
          syncStatus: "synced",
          id: result.serverId ?? item.recordId,
        });
        return;
      }

      if (result.status === "conflict") {
        await this.handleConflict(item, result.serverRecord);
        return;
      }

      throw new Error(result.message ?? "Unknown sync error");
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error("Unknown sync error");
      const backoffMs = Math.min(1000 * 2 ** item.attempts, 60_000);
      await db.sync_queue.update(item.id!, {
        status: "failed",
        attempts: item.attempts + 1,
        errorMessage: err.message,
      });
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  private async handleConflict(local: SyncQueueItem, serverRecord: Record<string, unknown> = {}) {
    const localPayload = local.payload as Record<string, unknown>;

    if (local.tableName === "stock_levels") {
      const currentQuantity = Number(localPayload.quantity ?? 0);
      const previousQuantity = Number(localPayload._previousQuantity ?? 0);
      const delta = currentQuantity - previousQuantity;
      const resolvedQty = Number(serverRecord.quantity ?? 0) + delta;
      await fetch("/api/sync/resolve", {
        method: "POST",
        body: JSON.stringify({ ...local, payload: { ...localPayload, quantity: resolvedQty } }),
        headers: { "Content-Type": "application/json" },
      });
      await db.sync_queue.update(local.id!, { status: "synced" });
      return;
    }

    if (local.tableName === "sales") {
      await db.sync_queue.update(local.id!, {
        status: "conflict",
        errorMessage: "Sale conflict - manual review needed",
      });
      return;
    }

    const localUpdatedAt = localPayload.updatedAt;
    const serverUpdatedAt = serverRecord.updatedAt;
    const localTime = new Date(typeof localUpdatedAt === "string" ? localUpdatedAt : 0).getTime();
    const serverTime = new Date(typeof serverUpdatedAt === "string" ? serverUpdatedAt : 0).getTime();

    if (localTime >= serverTime) {
      await fetch("/api/sync/force", {
        method: "POST",
        body: JSON.stringify(local),
        headers: { "Content-Type": "application/json" },
      });
    } else {
      const table = (db as unknown as Record<string, UpdatableTable | undefined>)[local.tableName];
      await table?.update(local.recordId, { ...serverRecord, syncStatus: "synced" });
    }

    await db.sync_queue.update(local.id!, { status: "synced" });
  }

  startWatcher() {
    window.addEventListener("online", () => {
      void this.flushQueue();
    });

    setInterval(() => {
      if (navigator.onLine) {
        void this.flushQueue();
      }
    }, SYNC_INTERVAL_MS);
  }

  async getPendingCount(): Promise<number> {
    return db.sync_queue.where("status").anyOf(["pending", "failed"]).count();
  }
}

export const syncEngine = new SyncEngine();
