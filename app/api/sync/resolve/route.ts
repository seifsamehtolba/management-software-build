import { NextRequest, NextResponse } from "next/server";
import { PERMISSIONS } from "@/lib/permissions";
import { processSyncMutation } from "@/lib/syncServer";
import { ensureBranchSyncAccess, requireSyncAccess } from "@/lib/syncAuth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const auth = await requireSyncAccess([PERMISSIONS.syncResolve]);
  if (!auth.ok) return auth.response;

  const body = (await req.json()) as {
    tableName: string;
    recordId: string;
    operation: "CREATE" | "UPDATE" | "DELETE";
    payload: Record<string, unknown>;
  };

  const branchCheck = ensureBranchSyncAccess({
    permissions: auth.user.permissions,
    userBranchId: auth.user.branchId,
    payload: body.payload,
  });
  if (!branchCheck.ok) return branchCheck.response;

  const result = await processSyncMutation(body);

  await prisma.activityLog.create({
    data: {
      userId: auth.user.id,
      action: "SYNC_RESOLVE",
      tableName: body.tableName,
      recordId: body.recordId,
      details: {
        operation: body.operation,
        resultStatus: result.status,
      },
    },
  });

  return NextResponse.json(result, {
    status: result.status === "error" ? 500 : 200,
  });
}
