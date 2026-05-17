import { v4 as uuid } from "uuid";
import { db } from "@/lib/localDb";

type WritableTable = {
  put: (value: unknown) => Promise<unknown>;
};

export async function writeLocal<T extends Record<string, unknown> & { id?: string; updatedAt?: string }>(
  tableName: keyof typeof db,
  record: T,
  operation: "CREATE" | "UPDATE" | "DELETE" = "CREATE",
): Promise<T & { id: string }> {
  const id = record.id ?? uuid();
  const now = new Date().toISOString();
  const fullRecord = { ...record, id, updatedAt: now, syncStatus: "pending" };

  const table = (db as unknown as Record<string, WritableTable>)[tableName as string];
  await table.put(fullRecord);
  await db.sync_queue.add({
    tableName: tableName as string,
    recordId: id,
    operation,
    payload: fullRecord,
    status: "pending",
    attempts: 0,
    createdAt: now,
  });

  return fullRecord as T & { id: string };
}
