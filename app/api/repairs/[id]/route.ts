import { NextRequest, NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };
type RepairStatus =
  | "RECEIVED"
  | "DIAGNOSING"
  | "WAITING_PARTS"
  | "IN_REPAIR"
  | "READY"
  | "DELIVERED"
  | "CANCELLED";

export async function GET(_: NextRequest, { params }: Params) {
  const { id } = await params;
  const ticket = await prisma.repairTicket.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, phone: true, creditBalance: true, loyaltyPoints: true } },
      parts: true,
      notes: true,
    },
  });
  if (!ticket) {
    return NextResponse.json({ message: "Repair ticket not found" }, { status: 404 });
  }
  return NextResponse.json({
    ...ticket,
    estimatedCost: ticket.estimatedCost ? Number(ticket.estimatedCost) : null,
    laborCost: ticket.laborCost ? Number(ticket.laborCost) : null,
    finalCost: ticket.finalCost ? Number(ticket.finalCost) : null,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    deliveredAt: ticket.deliveredAt ? ticket.deliveredAt.toISOString() : null,
  });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireApiAnyPermission([PERMISSIONS.repairsUpdate]);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = (await req.json()) as {
    status?: RepairStatus;
    technicianId?: string | null;
    estimatedCost?: number | null;
    finalCost?: number | null;
    notes?: string;
  };

  const updated = await prisma.repairTicket.update({
    where: { id },
    data: {
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.technicianId !== undefined ? { technicianId: body.technicianId?.trim() || null } : {}),
      ...(body.estimatedCost !== undefined ? { estimatedCost: body.estimatedCost } : {}),
      ...(body.finalCost !== undefined ? { finalCost: body.finalCost } : {}),
    },
    select: { id: true },
  });

  return NextResponse.json(updated);
}
