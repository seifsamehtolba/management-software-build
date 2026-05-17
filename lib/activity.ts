import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type ActivityInput = {
  userId: string;
  action: string;
  tableName?: string;
  recordId?: string;
  details?: Prisma.InputJsonValue;
};

export async function logActivity(input: ActivityInput) {
  await prisma.activityLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      tableName: input.tableName,
      recordId: input.recordId,
      details: input.details,
    },
  });
}
