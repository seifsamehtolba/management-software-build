import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { submitEtaInvoice } from "@/lib/eta";

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAnyPermission([PERMISSIONS.integrationsEtaSubmit]);
  if (!auth.ok) return auth.response;

  const body = (await req.json()) as {
    saleId: string;
    invoicePayload?: Record<string, unknown>;
  };

  if (!body.saleId) {
    return NextResponse.json({ message: "saleId is required" }, { status: 400 });
  }

  const log = await prisma.syncLog.create({
    data: {
      deviceId: "server",
      tableName: "eta_invoices",
      recordId: body.saleId,
      operation: "SUBMIT",
      payload: toJsonValue({
        saleId: body.saleId,
        invoicePayload: body.invoicePayload ?? {},
        attempts: 0,
      }),
      status: "queued",
      conflictNote: null,
    },
  });

  const submission = await submitEtaInvoice({
    saleId: body.saleId,
    invoicePayload: body.invoicePayload,
  });

  if (!submission.ok) {
    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        status: submission.retriable ? "error" : "failed",
        conflictNote: submission.message,
      },
    });
    return NextResponse.json(
      {
        status: submission.retriable ? "queued_for_retry" : "failed",
        saleId: body.saleId,
        logId: log.id,
        message: submission.message,
      },
      { status: submission.retriable ? 202 : 400 },
    );
  }

  await prisma.sale.update({
    where: { id: body.saleId },
    data: {
      isEtaSubmitted: true,
      etaUuid: submission.reference,
    },
  });
  await prisma.syncLog.update({
    where: { id: log.id },
    data: {
      status: "success",
      conflictNote: null,
      payload: toJsonValue({
        saleId: body.saleId,
        invoicePayload: body.invoicePayload ?? {},
        attempts: 1,
        etaReference: submission.reference,
      }),
    },
  });

  return NextResponse.json({
    status: "submitted",
    saleId: body.saleId,
    etaReference: submission.reference,
    logId: log.id,
    payloadAccepted: !!body.invoicePayload,
  });
}

export async function GET() {
  const auth = await requireApiAnyPermission([PERMISSIONS.integrationsEtaLogsRead]);
  if (!auth.ok) return auth.response;

  const logs = await prisma.syncLog.findMany({
    where: { tableName: "eta_invoices" },
    orderBy: { syncedAt: "desc" },
    take: 100,
  });
  return NextResponse.json(
    logs.map((log) => ({
      id: log.id,
      recordId: log.recordId,
      status: log.status,
      note: log.conflictNote,
      payload: log.payload,
      syncedAt: log.syncedAt.toISOString(),
    })),
  );
}
