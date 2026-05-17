import { NextRequest, NextResponse } from "next/server";
import { PERMISSIONS } from "@/lib/permissions";
import { processSyncMutation } from "@/lib/syncServer";
import { ensureBranchSyncAccess, requireSyncAccess } from "@/lib/syncAuth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const auth = await requireSyncAccess([PERMISSIONS.syncForce]);
  if (!auth.ok) return auth.response;

  const body = (await req.json()) as {
    tableName: string;
    recordId: string;
    operation: "CREATE" | "UPDATE" | "DELETE";
    payload: Record<string, unknown>;
  };

  const forced = {
    ...body,
    operation: "UPDATE" as const,
  };

  const branchCheck = ensureBranchSyncAccess({
    permissions: auth.user.permissions,
    userBranchId: auth.user.branchId,
    payload: forced.payload,
  });
  if (!branchCheck.ok) return branchCheck.response;

  const result = await processSyncMutation(forced);

  await prisma.activityLog.create({
    data: {
      userId: auth.user.id,
      action: "SYNC_FORCE_LOCAL",
      tableName: forced.tableName,
      recordId: forced.recordId,
      details: {
        requestedOperation: body.operation,
        forcedOperation: forced.operation,
        resultStatus: result.status,
      },
    },
  });

  return NextResponse.json(result, {
    status: result.status === "error" ? 500 : 200,
  });
}
