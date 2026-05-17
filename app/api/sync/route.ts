import { NextRequest, NextResponse } from "next/server";
import { PERMISSIONS } from "@/lib/permissions";
import { processSyncMutation } from "@/lib/syncServer";
import { ensureBranchSyncAccess, requireSyncAccess } from "@/lib/syncAuth";

export async function POST(req: NextRequest) {
  const auth = await requireSyncAccess([PERMISSIONS.syncMutate]);
  if (!auth.ok) return auth.response;

  const body = (await req.json()) as {
    tableName: string;
    recordId: string;
    operation: "CREATE" | "UPDATE" | "DELETE";
    payload: Record<string, unknown>;
  };

  if (!body?.tableName || !body?.recordId || !body?.operation || !body?.payload) {
    return NextResponse.json({ status: "error", message: "Invalid sync payload" }, { status: 400 });
  }

  const branchCheck = ensureBranchSyncAccess({
    permissions: auth.user.permissions,
    userBranchId: auth.user.branchId,
    payload: body.payload,
  });
  if (!branchCheck.ok) return branchCheck.response;

  const result = await processSyncMutation(body);
  return NextResponse.json(result, {
    status: result.status === "error" ? 500 : 200,
  });
}
