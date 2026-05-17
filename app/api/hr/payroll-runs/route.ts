import { NextRequest, NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { logActivity } from "@/lib/activity";
import { latestCompensation, resolvePayrollBranch } from "@/lib/hr";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

function overlapDaysInclusive(startA: Date, endA: Date, startB: Date, endB: Date) {
  const start = Math.max(startA.getTime(), startB.getTime());
  const end = Math.min(endA.getTime(), endB.getTime());
  if (end < start) return 0;
  return Math.floor((end - start) / (24 * 60 * 60 * 1000)) + 1;
}

function saleGrossProfit(sale: {
  items: Array<{ total: unknown; quantity: number; realizedCogs: unknown; product: { costPrice: unknown } }>;
}) {
  return roundMoney(
    sale.items.reduce((sum, item) => {
      const revenue = Number(item.total);
      const cogs = item.realizedCogs == null ? Number(item.product.costPrice) * item.quantity : Number(item.realizedCogs);
      return sum + revenue - cogs;
    }, 0),
  );
}

export async function GET(req: NextRequest) {
  const auth = await requireApiAnyPermission([PERMISSIONS.payrollRead]);
  if (!auth.ok) return auth.response;

  const requestedBranchId = req.nextUrl.searchParams.get("branchId")?.trim() || null;
  const effectiveBranchId = resolvePayrollBranch(auth.user, requestedBranchId);

  const rows = await prisma.payrollRun.findMany({
    where: effectiveBranchId ? { branchId: effectiveBranchId } : undefined,
    include: {
      branch: { select: { id: true, name: true } },
      processedBy: { select: { id: true, name: true } },
      items: {
        include: {
          employee: {
            select: {
              id: true,
              employeeCode: true,
              user: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
    orderBy: [{ periodStart: "desc" }, { createdAt: "desc" }],
    take: 50,
  });

  return NextResponse.json({
    rows: rows.map((row) => ({
      id: row.id,
      branch: row.branch,
      processedBy: row.processedBy,
      status: row.status,
      periodStart: row.periodStart.toISOString(),
      periodEnd: row.periodEnd.toISOString(),
      paidAt: row.paidAt?.toISOString() ?? null,
      notes: row.notes,
      createdAt: row.createdAt.toISOString(),
      items: row.items.map((item) => ({
        id: item.id,
        employee: item.employee,
        baseSalary: Number(item.baseSalary),
        allowances: Number(item.allowances),
        deductions: Number(item.deductions),
        leaveDeduction: Number(item.leaveDeduction),
        commissions: Number(item.commissions),
        overtime: Number(item.overtime),
        netPay: Number(item.netPay),
        paymentStatus: item.paymentStatus,
      })),
    })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAnyPermission([PERMISSIONS.payrollManage]);
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => ({}))) as {
    branchId?: string | null;
    periodStart?: string;
    periodEnd?: string;
    notes?: string;
  };

  if (!body.periodStart || !body.periodEnd) {
    return NextResponse.json({ message: "Payroll period is required" }, { status: 400 });
  }

  const periodStart = new Date(body.periodStart);
  const periodEnd = new Date(body.periodEnd);
  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime()) || periodEnd < periodStart) {
    return NextResponse.json({ message: "Invalid payroll period" }, { status: 400 });
  }

  const branchId = resolvePayrollBranch(auth.user, body.branchId ?? null);

  const employees = await prisma.employeeProfile.findMany({
    where: {
      isActive: true,
      ...(branchId ? { branchId } : {}),
    },
    include: {
      user: { select: { id: true, name: true } },
      compensationHistory: {
        where: { effectiveFrom: { lte: periodEnd } },
        orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
      },
      commissionRules: {
        where: { isActive: true, effectiveFrom: { lte: periodEnd } },
        orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
      },
      attendanceEntries: {
        where: { date: { gte: periodStart, lte: periodEnd } },
      },
      leaveRequests: {
        where: {
          status: "APPROVED",
          endDate: { gte: periodStart },
          startDate: { lte: periodEnd },
        },
      },
    },
  });

  if (employees.length === 0) {
    return NextResponse.json({ message: "No active employees found for this payroll scope" }, { status: 400 });
  }

  const sales = await prisma.sale.findMany({
    where: {
      status: "COMPLETED",
      cashierId: { in: employees.map((employee) => employee.userId) },
      createdAt: { gte: periodStart, lte: periodEnd },
    },
    select: {
      id: true,
      cashierId: true,
      total: true,
      items: {
        select: {
          total: true,
          quantity: true,
          realizedCogs: true,
          product: { select: { costPrice: true } },
        },
      },
    },
  });

  const salesByCashier = new Map<string, typeof sales>();
  for (const sale of sales) {
    const bucket = salesByCashier.get(sale.cashierId) ?? [];
    bucket.push(sale);
    salesByCashier.set(sale.cashierId, bucket);
  }

  const payrollRows = employees.map((employee) => {
    const compensation = latestCompensation(employee.compensationHistory);
    const baseSalary = Number(compensation?.baseSalary ?? 0);
    const allowance = Number(compensation?.allowance ?? 0);
    const transportAllowance = Number(compensation?.transportAllowance ?? 0);
    const allowanceTotal = roundMoney(allowance + transportAllowance);
    const absenceDays = employee.attendanceEntries.filter((entry) => entry.status === "ABSENT").length;
    const unpaidLeaveDays = employee.leaveRequests
      .filter((leave) => leave.type === "UNPAID")
      .reduce((sum, leave) => sum + overlapDaysInclusive(leave.startDate, leave.endDate, periodStart, periodEnd), 0);
    const leaveDeduction = roundMoney(((baseSalary || 0) / 30) * (absenceDays + unpaidLeaveDays));
    const commissionRule = employee.commissionRules[0] ?? null;
    const employeeSales = salesByCashier.get(employee.userId) ?? [];
    const commissionLines = employeeSales.map((sale) => {
      let amount = 0;
      if (commissionRule?.type === "PERCENT_OF_REVENUE") {
        amount = Number(sale.total) * (Number(commissionRule.rate) / 100);
      } else if (commissionRule?.type === "FIXED_PER_SALE") {
        amount = Number(commissionRule.rate);
      } else if (commissionRule?.type === "MARGIN_SHARE") {
        amount = saleGrossProfit(sale) * (Number(commissionRule.rate) / 100);
      }
      return {
        saleId: sale.id,
        amount: roundMoney(amount),
        basisAmount:
          commissionRule?.type === "MARGIN_SHARE" ? saleGrossProfit(sale) : Number(sale.total),
      };
    }).filter((line) => line.amount > 0);
    const commissions = roundMoney(commissionLines.reduce((sum, line) => sum + line.amount, 0));
    const netPay = roundMoney(baseSalary + allowanceTotal + commissions - leaveDeduction);
    return {
      employee,
      baseSalary,
      allowanceTotal,
      leaveDeduction,
      commissions,
      netPay,
      commissionLines,
    };
  });

  const run = await prisma.$transaction(async (tx) => {
    const payrollRun = await tx.payrollRun.create({
      data: {
        branchId,
        periodStart,
        periodEnd,
        notes: body.notes?.trim() || null,
        processedById: auth.user.id,
        items: {
          create: payrollRows.map((row) => ({
            employeeId: row.employee.id,
            baseSalary: row.baseSalary,
            allowances: row.allowanceTotal,
            deductions: 0,
            leaveDeduction: row.leaveDeduction,
            commissions: row.commissions,
            overtime: 0,
            netPay: row.netPay,
          })),
        },
      },
      include: {
        items: { select: { id: true, employeeId: true } },
      },
    });

    const itemByEmployee = new Map(payrollRun.items.map((item) => [item.employeeId, item.id]));
    for (const row of payrollRows) {
      const payrollItemId = itemByEmployee.get(row.employee.id);
      if (!payrollItemId) continue;
      for (const line of row.commissionLines) {
        await tx.commissionEntry.create({
          data: {
            employeeId: row.employee.id,
            saleId: line.saleId,
            payrollItemId,
            amount: line.amount,
            basisAmount: line.basisAmount,
            sourceType: "SALE",
            note: `Computed for payroll period ${body.periodStart} - ${body.periodEnd}`,
          },
        });
      }
    }

    return payrollRun;
  });

  await logActivity({
    userId: auth.user.id,
    action: "PAYROLL_RUN_CREATED",
    tableName: "PayrollRun",
    recordId: run.id,
    details: { branchId, periodStart: body.periodStart, periodEnd: body.periodEnd, employeeCount: employees.length },
  });

  return NextResponse.json({ id: run.id }, { status: 201 });
}
