import { NextRequest, NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { logActivity } from "@/lib/activity";
import { canAccessPayrollBranch, latestCompensation, resolvePayrollBranch } from "@/lib/hr";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

function moneyOrZero(value: number | undefined) {
  return Number.isFinite(value) ? Number(value) : 0;
}

export async function GET(req: NextRequest) {
  const auth = await requireApiAnyPermission([PERMISSIONS.hrRead, PERMISSIONS.payrollRead]);
  if (!auth.ok) return auth.response;

  const requestedBranchId = req.nextUrl.searchParams.get("branchId")?.trim() || null;
  const effectiveBranchId = resolvePayrollBranch(auth.user, requestedBranchId);

  const rows = await prisma.employeeProfile.findMany({
    where: effectiveBranchId ? { branchId: effectiveBranchId } : undefined,
    include: {
      branch: { select: { id: true, name: true } },
      user: { select: { id: true, name: true, email: true, branchId: true, isActive: true } },
      compensationHistory: {
        orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
        take: 5,
      },
      commissionRules: {
        where: { isActive: true },
        orderBy: { effectiveFrom: "desc" },
        take: 1,
      },
      attendanceEntries: {
        orderBy: { date: "desc" },
        take: 14,
      },
      leaveRequests: {
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
    orderBy: [{ branchId: "asc" }, { createdAt: "asc" }],
  });

  return NextResponse.json({
    rows: rows.map((row) => {
      const currentComp = latestCompensation(row.compensationHistory);
      return {
        id: row.id,
        employeeCode: row.employeeCode,
        title: row.title,
        department: row.department,
        hireDate: row.hireDate?.toISOString() ?? null,
        payFrequency: row.payFrequency,
        notes: row.notes,
        isActive: row.isActive,
        branch: row.branch,
        user: row.user,
        currentCompensation: currentComp
          ? {
              id: currentComp.id,
              baseSalary: Number(currentComp.baseSalary),
              allowance: Number(currentComp.allowance),
              transportAllowance: Number(currentComp.transportAllowance),
              effectiveFrom: currentComp.effectiveFrom.toISOString(),
              notes: currentComp.notes,
            }
          : null,
        commissionRule: row.commissionRules[0]
          ? {
              id: row.commissionRules[0].id,
              type: row.commissionRules[0].type,
              rate: Number(row.commissionRules[0].rate),
              effectiveFrom: row.commissionRules[0].effectiveFrom.toISOString(),
            }
          : null,
        recentAttendance: row.attendanceEntries.map((entry) => ({
          id: entry.id,
          date: entry.date.toISOString(),
          status: entry.status,
          workedMinutes: entry.workedMinutes,
          note: entry.note,
        })),
        leaveRequests: row.leaveRequests.map((leave) => ({
          id: leave.id,
          type: leave.type,
          status: leave.status,
          startDate: leave.startDate.toISOString(),
          endDate: leave.endDate.toISOString(),
          reason: leave.reason,
        })),
      };
    }),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAnyPermission([PERMISSIONS.hrManage, PERMISSIONS.payrollManage]);
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => ({}))) as {
    userId?: string;
    branchId?: string | null;
    employeeCode?: string;
    title?: string;
    department?: string;
    hireDate?: string;
    payFrequency?: "MONTHLY" | "WEEKLY" | "BIWEEKLY";
    notes?: string;
    baseSalary?: number;
    allowance?: number;
    transportAllowance?: number;
    effectiveFrom?: string;
    commissionType?: "PERCENT_OF_REVENUE" | "FIXED_PER_SALE" | "MARGIN_SHARE";
    commissionRate?: number;
  };

  if (!body.userId || !body.employeeCode?.trim()) {
    return NextResponse.json({ message: "User and employee code are required" }, { status: 400 });
  }
  const userId = body.userId;
  const employeeCode = body.employeeCode.trim();

  const targetBranchId = body.branchId ?? auth.user.branchId;
  if (!canAccessPayrollBranch(auth.user, targetBranchId)) {
    return NextResponse.json({ message: "You can only manage employees in your own branch" }, { status: 403 });
  }

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, branchId: true },
    });
    if (!user) {
      return { ok: false as const, message: "User not found" };
    }

    const existing = await tx.employeeProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (existing) {
      return { ok: false as const, message: "Employee profile already exists" };
    }

    const employee = await tx.employeeProfile.create({
      data: {
        userId,
        branchId: targetBranchId,
        employeeCode,
        title: body.title?.trim() || null,
        department: body.department?.trim() || null,
        hireDate: body.hireDate ? new Date(body.hireDate) : null,
        payFrequency: body.payFrequency ?? "MONTHLY",
        notes: body.notes?.trim() || null,
        compensationHistory: {
          create: {
            baseSalary: moneyOrZero(body.baseSalary),
            allowance: moneyOrZero(body.allowance),
            transportAllowance: moneyOrZero(body.transportAllowance),
            effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : new Date(),
            changedById: auth.user.id,
          },
        },
        commissionRules:
          body.commissionType && Number.isFinite(body.commissionRate)
            ? {
                create: {
                  type: body.commissionType,
                  rate: Number(body.commissionRate),
                  effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : new Date(),
                },
              }
            : undefined,
      },
      select: { id: true },
    });

    await tx.user.update({
      where: { id: userId },
      data: { branchId: targetBranchId ?? user.branchId },
    });

    return { ok: true as const, employeeId: employee.id };
  });

  if (!result.ok) {
    return NextResponse.json({ message: result.message }, { status: 400 });
  }

  await logActivity({
    userId: auth.user.id,
    action: "EMPLOYEE_PROFILE_CREATED",
    tableName: "EmployeeProfile",
    recordId: result.employeeId,
    details: { userId, branchId: targetBranchId },
  });

  return NextResponse.json({ id: result.employeeId }, { status: 201 });
}
