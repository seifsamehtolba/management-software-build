import { NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { DEFAULT_ELEVATION_GRANTS, signElevationToken } from "@/lib/elevationToken";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  const auth = await requireApiAnyPermission([PERMISSIONS.elevationApprovalsResolve]);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = (await req.json()) as { approve?: boolean };
  const approve = body.approve === true;

  const row = await prisma.elevationApproval.findUnique({ where: { id } });
  if (!row || row.status !== "PENDING") {
    return NextResponse.json({ message: "Request not pending" }, { status: 400 });
  }

  if (!approve) {
    await prisma.elevationApproval.update({
      where: { id },
      data: {
        status: "DENIED",
        resolverId: auth.user.id,
        resolvedAt: new Date(),
      },
    });
    return NextResponse.json({ ok: true, status: "DENIED" });
  }

  const token = signElevationToken({
    sub: row.requesterId,
    grants: [...DEFAULT_ELEVATION_GRANTS],
    exp: Math.floor(Date.now() / 1000) + 5 * 60,
  });

  await prisma.elevationApproval.update({
    where: { id },
    data: {
      status: "APPROVED",
      resolverId: auth.user.id,
      resolvedAt: new Date(),
      issuedToken: token,
    },
  });

  return NextResponse.json({ ok: true, status: "APPROVED" });
}
