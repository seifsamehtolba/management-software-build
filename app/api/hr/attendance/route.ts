import { NextRequest, NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { logActivity } from "@/lib/activity";
import { canAccessPayrollBranch, resolvePayrollBranch } from "@/lib/hr";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const auth = await requireApiAnyPermission([PERMISSIONS.hrRead]);
  if (!auth.ok) return auth.response;

  const requestedBranchId = req.nextUrl.searchParams.get("branchId")?.trim() || null;
  const employeeId = req.nextUrl.searchParams.get("employeeId")?.trim() || null;
  const effectiveBranchId = resolvePayrollBranch(auth.user, requestedBranchId);
  const dateFrom = req.nextUrl.searchParams.get("dateFrom")?.trim();
  const dateTo = req.nextUrl.searchParams.get("dateTo")?.trim();

  const rows = await prisma.attendanceEntry.findMany({
    where: {
      ...(employeeId ? { employeeId } : {}),
      ...(effectiveBranchId ? { employee: { branchId: effectiveBranchId } } : {}),
      ...(dateFrom || dateTo
        ? {
            date: {
              ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
              ...(dateTo ? { lte: new Date(dateTo) } : {}),
            },
          }
        : {}),
    },
    include: {
      employee: {
        select: {
          id: true,
          employeeCode: true,
          user: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 200,
  });

  return NextResponse.json({
    rows: rows.map((row) => ({
      id: row.id,
      employee: row.employee,
      date: row.date.toISOString(),
      status: row.status,
      checkIn: row.checkIn?.toISOString() ?? null,
      checkOut: row.checkOut?.toISOString() ?? null,
      workedMinutes: row.workedMinutes,
      note: row.note,
    })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAnyPermission([PERMISSIONS.hrManage]);
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => ({}))) as {
    employeeId?: string;
    date?: string;
    status?: "PRESENT" | "ABSENT" | "LATE" | "HALF_DAY" | "LEAVE";
    checkIn?: string;
    checkOut?: string;
    workedMinutes?: number;
    note?: string;
  };

  if (!body.employeeId || !body.date || !body.status) {
    return NextResponse.json({ message: "Employee, date, and status are required" }, { status: 400 });
  }

  const employee = await prisma.employeeProfile.findUnique({
    where: { id: body.employeeId },
    select: { branchId: true },
  });
  if (!employee) {
    return NextResponse.json({ message: "Employee not found" }, { status: 404 });
  }
  if (!canAccessPayrollBranch(auth.user, employee.branchId)) {
    return NextResponse.json({ message: "You can only manage attendance for your own branch" }, { status: 403 });
  }

  const entry = await prisma.attendanceEntry.upsert({
    where: {
      employeeId_date: {
        employeeId: body.employeeId,
        date: new Date(body.date),
      },
    },
    update: {
      status: body.status,
      checkIn: body.checkIn ? new Date(body.checkIn) : null,
      checkOut: body.checkOut ? new Date(body.checkOut) : null,
      workedMinutes: Math.max(0, Math.trunc(Number(body.workedMinutes ?? 0))),
      note: body.note?.trim() || null,
      recordedById: auth.user.id,
    },
    create: {
      employeeId: body.employeeId,
      date: new Date(body.date),
      status: body.status,
      checkIn: body.checkIn ? new Date(body.checkIn) : null,
      checkOut: body.checkOut ? new Date(body.checkOut) : null,
      workedMinutes: Math.max(0, Math.trunc(Number(body.workedMinutes ?? 0))),
      note: body.note?.trim() || null,
      recordedById: auth.user.id,
    },
  });

  await logActivity({
    userId: auth.user.id,
    action: "ATTENDANCE_RECORDED",
    tableName: "AttendanceEntry",
    recordId: entry.id,
    details: { employeeId: body.employeeId, status: body.status, date: body.date },
  });

  return NextResponse.json({ id: entry.id }, { status: 201 });
}
