import { NextRequest, NextResponse } from "next/server";
import { PERMISSIONS } from "@/lib/permissions";
import { ensureBranchSyncAccess, requireSyncAccess } from "@/lib/syncAuth";
import { getSyncServerRecord } from "@/lib/syncServer";

export async function POST(req: NextRequest) {
  const auth = await requireSyncAccess([PERMISSIONS.syncPreview]);
  if (!auth.ok) return auth.response;

  const body = (await req.json()) as {
    tableName: string;
    recordId: string;
    payload?: Record<string, unknown>;
  };

  if (!body?.tableName || !body?.recordId) {
    return NextResponse.json({ status: "error", message: "Invalid preview payload" }, { status: 400 });
  }

  const branchCheck = ensureBranchSyncAccess({
    permissions: auth.user.permissions,
    userBranchId: auth.user.branchId,
    payload: body.payload,
  });
  if (!branchCheck.ok) return branchCheck.response;

  const serverRecord = await getSyncServerRecord(body.tableName, body.recordId);
  return NextResponse.json({
    status: "ok",
    serverRecord,
    localPayload: body.payload ?? null,
  });
}
