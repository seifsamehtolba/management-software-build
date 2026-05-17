import { NextRequest, NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();

  const tickets = await prisma.repairTicket.findMany({
    where: q
      ? {
          OR: [
            { ticketNumber: { contains: q } },
            { deviceName: { contains: q } },
            { customer: { name: { contains: q } } },
            { customer: { phone: { contains: q } } },
          ],
        }
      : undefined,
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      customer: { select: { id: true, name: true, phone: true } },
    },
  });

  return NextResponse.json(
    tickets.map((t) => ({
      id: t.id,
      ticketNumber: t.ticketNumber,
      customerId: t.customerId,
      customerName: t.customer.name,
      customerPhone: t.customer.phone,
      deviceName: t.deviceName,
      issueDesc: t.issueDesc,
      status: t.status,
      estimatedCost: t.estimatedCost ? Number(t.estimatedCost) : null,
      finalCost: t.finalCost ? Number(t.finalCost) : null,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    })),
  );
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAnyPermission([PERMISSIONS.repairsCreate]);
  if (!auth.ok) return auth.response;

  const body = (await req.json()) as {
    customerId: string;
    deviceName: string;
    issueDesc: string;
    technicianId?: string | null;
    estimatedCost?: number | null;
  };

  if (!body.customerId || !body.deviceName || !body.issueDesc) {
    return NextResponse.json({ message: "customerId, deviceName, issueDesc are required" }, { status: 400 });
  }

  const now = new Date();
  const ticketNumber = `RT-${now.toISOString().slice(0, 10).replaceAll("-", "")}-${Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, "0")}`;

  const ticket = await prisma.repairTicket.create({
    data: {
      ticketNumber,
      customerId: body.customerId,
      deviceName: body.deviceName.trim(),
      issueDesc: body.issueDesc.trim(),
      technicianId: body.technicianId?.trim() || null,
      estimatedCost: body.estimatedCost ?? null,
    },
    select: { id: true, ticketNumber: true },
  });

  return NextResponse.json(ticket, { status: 201 });
}
