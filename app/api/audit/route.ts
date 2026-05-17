import { NextRequest, NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const auth = await requireApiAnyPermission([PERMISSIONS.auditRead]);
  if (!auth.ok) return auth.response;

  const q = req.nextUrl.searchParams.get("q")?.trim();
  const tableName = req.nextUrl.searchParams.get("tableName")?.trim();

  const rows = await prisma.activityLog.findMany({
    where: {
      ...(tableName ? { tableName } : {}),
      ...(q
        ? {
            OR: [
              { action: { contains: q } },
              { tableName: { contains: q } },
              { recordId: { contains: q } },
              { user: { name: { contains: q } } },
            ],
          }
        : {}),
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return NextResponse.json({
    rows: rows.map((row) => ({
      id: row.id,
      action: row.action,
      tableName: row.tableName,
      recordId: row.recordId,
      details: row.details,
      createdAt: row.createdAt.toISOString(),
      user: row.user,
    })),
  });
}
