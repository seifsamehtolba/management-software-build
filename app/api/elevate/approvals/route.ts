import { NextResponse } from "next/server";
import { requireApiAnyPermission, requireSession } from "@/lib/apiAuth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

/** Owner/manager: list pending + today's resolved */
export async function GET() {
  const auth = await requireApiAnyPermission([PERMISSIONS.elevationApprovalsRead]);
  if (!auth.ok) return auth.response;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await prisma.elevationApproval.findMany({
    where: {
      OR: [{ status: "PENDING" }, { resolvedAt: { gte: since } }],
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      requester: { select: { id: true, name: true, email: true, role: true } },
      resolver: { select: { id: true, name: true, email: true } },
    },
  });

  return NextResponse.json({ approvals: rows });
}

/** Any logged-in user: request approval for a restricted action */
export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const body = (await req.json()) as { summary?: string; routeHint?: string };
  const summary = body.summary?.trim();
  if (!summary || summary.length < 3) {
    return NextResponse.json({ message: "Describe the action (summary)" }, { status: 400 });
  }

  const row = await prisma.elevationApproval.create({
    data: {
      requesterId: auth.user.id,
      summary: summary.slice(0, 500),
      routeHint: body.routeHint?.slice(0, 200) ?? null,
      status: "PENDING",
    },
  });

  return NextResponse.json({ id: row.id });
}
