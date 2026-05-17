import { createHash, randomInt } from "crypto";
import { NextResponse } from "next/server";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

function hashCode(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/** Owner/manager generates a 6-digit code valid for 10 minutes */
export async function POST() {
  const auth = await requireApiAnyPermission([PERMISSIONS.elevationCodeIssue]);
  if (!auth.ok) return auth.response;

  const digits = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  try {
    await prisma.elevationCode.create({
      data: {
        codeHash: hashCode(digits),
        createdById: auth.user.id,
        expiresAt,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not create elevation code";
    console.error("[api/elevate/code]", e);
    return NextResponse.json({ message }, { status: 500 });
  }

  return NextResponse.json({
    code: digits,
    expiresAt: expiresAt.toISOString(),
    message: "Share this code with the cashier. It expires in 10 minutes.",
  });
}
