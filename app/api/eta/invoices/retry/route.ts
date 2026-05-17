import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { submitEtaInvoice } from "@/lib/eta";

const MAX_RETRIES = 5;

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function POST() {
  const auth = await requireApiAnyPermission([PERMISSIONS.integrationsEtaRetry]);
  if (!auth.ok) return auth.response;

  const logs = await prisma.syncLog.findMany({
    where: {
      tableName: "eta_invoices",
      status: { in: ["error", "queued"] },
    },
    orderBy: { syncedAt: "asc" },
    take: 20,
  });

  let retried = 0;
  let submitted = 0;

  for (const log of logs) {
    const payload = (log.payload ?? {}) as Record<string, unknown>;
    const attempts = Number(payload.attempts ?? 0);
    const saleId = typeof payload.saleId === "string" ? payload.saleId : log.recordId;
    const invoicePayload =
      payload.invoicePayload && typeof payload.invoicePayload === "object"
        ? (payload.invoicePayload as Record<string, unknown>)
        : undefined;

    if (!saleId || attempts >= MAX_RETRIES) {
      await prisma.syncLog.update({
        where: { id: log.id },
        data: { status: "failed", conflictNote: "Max ETA retry attempts reached" },
      });
      continue;
    }

    retried += 1;
    const submission = await submitEtaInvoice({ saleId, invoicePayload });
    if (!submission.ok) {
      await prisma.syncLog.update({
        where: { id: log.id },
        data: {
          status: submission.retriable ? "error" : "failed",
          conflictNote: submission.message,
          payload: toJsonValue({
            ...payload,
            attempts: attempts + 1,
          }),
        },
      });
      continue;
    }

    submitted += 1;
    await prisma.sale.update({
      where: { id: saleId },
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
          ...payload,
          attempts: attempts + 1,
          etaReference: submission.reference,
        }),
      },
    });
  }

  return NextResponse.json({
    processed: logs.length,
    retried,
    submitted,
  });
}
