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
  const status = req.nextUrl.searchParams.get("status")?.trim() || null;
  const effectiveBranchId = resolvePayrollBranch(auth.user, requestedBranchId);

  const rows = await prisma.leaveRequest.findMany({
    where: {
      ...(effectiveBranchId ? { employee: { branchId: effectiveBranchId } } : {}),
      ...(status ? { status: status as never } : {}),
    },
    include: {
      employee: {
        select: {
          id: true,
          employeeCode: true,
          user: { select: { id: true, name: true } },
        },
      },
      approvedBy: { select: { id: true, name: true } },
    },
    orderBy: [{ status: "asc" }, { startDate: "desc" }],
    take: 100,
  });

  return NextResponse.json({
    rows: rows.map((row) => ({
      id: row.id,
      type: row.type,
      status: row.status,
      startDate: row.startDate.toISOString(),
      endDate: row.endDate.toISOString(),
      reason: row.reason,
      note: row.note,
      employee: row.employee,
      approvedBy: row.approvedBy,
      approvedAt: row.approvedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAnyPermission([PERMISSIONS.hrManage]);
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    employeeId?: string;
    type?: "ANNUAL" | "SICK" | "UNPAID" | "OTHER";
    startDate?: string;
    endDate?: string;
    reason?: string;
    note?: string;
    status?: "PENDING" | "APPROVED" | "REJECTED";
  };

  if (body.id) {
    const leave = await prisma.leaveRequest.findUnique({
      where: { id: body.id },
      include: { employee: { select: { branchId: true } } },
    });
    if (!leave) {
      return NextResponse.json({ message: "Leave request not found" }, { status: 404 });
    }
    if (!canAccessPayrollBranch(auth.user, leave.employee.branchId)) {
      return NextResponse.json({ message: "You can only manage leave for your own branch" }, { status: 403 });
    }

    const updated = await prisma.leaveRequest.update({
      where: { id: body.id },
      data: {
        status: body.status ?? leave.status,
        note: body.note?.trim() || leave.note,
        approvedById: body.status === "APPROVED" || body.status === "REJECTED" ? auth.user.id : undefined,
        approvedAt: body.status === "APPROVED" || body.status === "REJECTED" ? new Date() : undefined,
      },
    });

    await logActivity({
      userId: auth.user.id,
      action: "LEAVE_REQUEST_UPDATED",
      tableName: "LeaveRequest",
      recordId: updated.id,
      details: { status: updated.status },
    });

    return NextResponse.json({ id: updated.id });
  }

  if (!body.employeeId || !body.type || !body.startDate || !body.endDate) {
    return NextResponse.json({ message: "Employee, type, and date range are required" }, { status: 400 });
  }

  const employee = await prisma.employeeProfile.findUnique({
    where: { id: body.employeeId },
    select: { branchId: true },
  });
  if (!employee) {
    return NextResponse.json({ message: "Employee not found" }, { status: 404 });
  }
  if (!canAccessPayrollBranch(auth.user, employee.branchId)) {
    return NextResponse.json({ message: "You can only manage leave for your own branch" }, { status: 403 });
  }

  const leave = await prisma.leaveRequest.create({
    data: {
      employeeId: body.employeeId,
      type: body.type,
      startDate: new Date(body.startDate),
      endDate: new Date(body.endDate),
      reason: body.reason?.trim() || null,
      note: body.note?.trim() || null,
    },
  });

  await logActivity({
    userId: auth.user.id,
    action: "LEAVE_REQUEST_CREATED",
    tableName: "LeaveRequest",
    recordId: leave.id,
    details: { employeeId: body.employeeId, type: body.type },
  });

  return NextResponse.json({ id: leave.id }, { status: 201 });
}
