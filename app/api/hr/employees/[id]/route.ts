import { NextRequest, NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { logActivity } from "@/lib/activity";
import { canAccessPayrollBranch } from "@/lib/hr";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

function numberOrZero(value: number | undefined) {
  return Number.isFinite(value) ? Number(value) : 0;
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireApiAnyPermission([PERMISSIONS.hrManage, PERMISSIONS.payrollManage]);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    branchId?: string | null;
    employeeCode?: string;
    title?: string | null;
    department?: string | null;
    hireDate?: string | null;
    payFrequency?: "MONTHLY" | "WEEKLY" | "BIWEEKLY";
    notes?: string | null;
    isActive?: boolean;
    compensation?: {
      baseSalary?: number;
      allowance?: number;
      transportAllowance?: number;
      effectiveFrom?: string;
      notes?: string | null;
    };
    commissionRule?: {
      type?: "PERCENT_OF_REVENUE" | "FIXED_PER_SALE" | "MARGIN_SHARE";
      rate?: number;
      effectiveFrom?: string;
      notes?: string | null;
    } | null;
  };

  const employee = await prisma.employeeProfile.findUnique({
    where: { id },
    include: {
      compensationHistory: {
        orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
        take: 1,
      },
    },
  });
  if (!employee) {
    return NextResponse.json({ message: "Employee not found" }, { status: 404 });
  }
  if (!canAccessPayrollBranch(auth.user, employee.branchId)) {
    return NextResponse.json({ message: "You can only manage employees in your own branch" }, { status: 403 });
  }

  const nextBranchId = body.branchId === undefined ? employee.branchId : body.branchId;
  if (!canAccessPayrollBranch(auth.user, nextBranchId)) {
    return NextResponse.json({ message: "You can only move employees within your own branch" }, { status: 403 });
  }

  const retroactiveEffectiveFrom = body.compensation?.effectiveFrom ? new Date(body.compensation.effectiveFrom) : null;
  if (
    retroactiveEffectiveFrom &&
    retroactiveEffectiveFrom.getTime() < new Date(new Date().toDateString()).getTime() &&
    !hasPermission(auth.user.permissions, PERMISSIONS.payrollOverrideManage)
  ) {
    return NextResponse.json(
      { message: "Retroactive payroll edits require override permission", code: "ELEVATION_REQUIRED" },
      { status: 403 },
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.employeeProfile.update({
      where: { id },
      data: {
        branchId: nextBranchId,
        employeeCode: body.employeeCode?.trim() || undefined,
        title: body.title === undefined ? undefined : body.title?.trim() || null,
        department: body.department === undefined ? undefined : body.department?.trim() || null,
        hireDate: body.hireDate === undefined ? undefined : body.hireDate ? new Date(body.hireDate) : null,
        payFrequency: body.payFrequency ?? undefined,
        notes: body.notes === undefined ? undefined : body.notes?.trim() || null,
        isActive: body.isActive,
      },
    });

    if (body.compensation) {
      await tx.compensationHistory.create({
        data: {
          employeeId: id,
          baseSalary: numberOrZero(body.compensation.baseSalary),
          allowance: numberOrZero(body.compensation.allowance),
          transportAllowance: numberOrZero(body.compensation.transportAllowance),
          effectiveFrom: retroactiveEffectiveFrom ?? new Date(),
          notes: body.compensation.notes?.trim() || null,
          changedById: auth.user.id,
        },
      });
    }

    if (body.commissionRule) {
      await tx.commissionRule.updateMany({
        where: { employeeId: id, isActive: true },
        data: { isActive: false },
      });
      if (body.commissionRule.type && Number.isFinite(body.commissionRule.rate)) {
        await tx.commissionRule.create({
          data: {
            employeeId: id,
            type: body.commissionRule.type,
            rate: Number(body.commissionRule.rate),
            effectiveFrom: body.commissionRule.effectiveFrom ? new Date(body.commissionRule.effectiveFrom) : new Date(),
            notes: body.commissionRule.notes?.trim() || null,
          },
        });
      }
    }

    if (body.branchId !== undefined) {
      await tx.user.update({
        where: { id: employee.userId },
        data: { branchId: nextBranchId },
      });
    }
  });

  await logActivity({
    userId: auth.user.id,
    action: "EMPLOYEE_PROFILE_UPDATED",
    tableName: "EmployeeProfile",
    recordId: id,
    details: {
      branchId: nextBranchId,
      compensationChanged: Boolean(body.compensation),
      commissionChanged: body.commissionRule !== undefined,
    },
  });

  return NextResponse.json({ ok: true });
}
