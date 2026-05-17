import { NextRequest, NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { branchScope } from "@/lib/quotes";

export async function GET(req: NextRequest) {
  const auth = await requireApiAnyPermission([PERMISSIONS.reportsFinanceRead]);
  if (!auth.ok) return auth.response;

  const requestedBranchId = req.nextUrl.searchParams.get("branchId")?.trim() ?? "";
  const effectiveBranchId = branchScope(auth.user, requestedBranchId, PERMISSIONS.reportsFinanceCrossBranch);

  const expenses = await prisma.expense.findMany({
    where: effectiveBranchId ? { user: { branchId: effectiveBranchId } } : undefined,
    include: {
      category: { select: { name: true } },
      user: { select: { name: true, branch: { select: { name: true } } } },
    },
    orderBy: { date: "desc" },
    take: 50,
  });

  return NextResponse.json(
    expenses.map((expense) => ({
      id: expense.id,
      amount: Number(expense.amount),
      date: expense.date.toISOString(),
      description: expense.description,
      categoryName: expense.category.name,
      userName: expense.user.name,
      branchName: expense.user.branch?.name ?? "Unassigned",
    })),
  );
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAnyPermission([PERMISSIONS.financeExpensesManage]);
  if (!auth.ok) return auth.response;

  const body = (await req.json()) as {
    categoryId?: string;
    categoryName?: string;
    amount?: number;
    description?: string;
    date?: string;
  };

  const amount = Number(body.amount);
  const description = body.description?.trim();
  const categoryId = body.categoryId?.trim();
  const categoryName = body.categoryName?.trim();

  if ((!categoryId && !categoryName) || !Number.isFinite(amount) || amount <= 0 || !description) {
    return NextResponse.json({ message: "category, amount, and description are required" }, { status: 400 });
  }

  const expense = await prisma.$transaction(async (tx) => {
    const category =
      categoryId
        ? await tx.expenseCategory.findUnique({ where: { id: categoryId }, select: { id: true } })
        : await tx.expenseCategory.upsert({
            where: { name: categoryName! },
            create: { name: categoryName! },
            update: {},
            select: { id: true },
          });

    if (!category) {
      throw new Error("Expense category not found");
    }

    return tx.expense.create({
      data: {
        categoryId: category.id,
        amount,
        description,
        userId: auth.user.id,
        date: body.date ? new Date(body.date) : new Date(),
      },
      include: {
        category: { select: { name: true } },
      },
    });
  });

  return NextResponse.json({
    id: expense.id,
    amount: Number(expense.amount),
    description: expense.description,
    date: expense.date.toISOString(),
    categoryName: expense.category.name,
  }, { status: 201 });
}
