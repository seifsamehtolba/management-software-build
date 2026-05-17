import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DEFAULT_ELEVATION_GRANTS, signElevationToken } from "@/lib/elevationToken";

function hashCode(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as { code?: string };
  const raw = body.code?.replace(/\D/g, "").slice(0, 6) ?? "";
  if (raw.length !== 6) {
    return NextResponse.json({ message: "Enter the 6-digit code" }, { status: 400 });
  }

  const h = hashCode(raw);
  const row = await prisma.elevationCode.findFirst({
    where: {
      codeHash: h,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
  });

  if (!row) {
    return NextResponse.json({ message: "Invalid or expired code" }, { status: 400 });
  }

  await prisma.elevationCode.update({
    where: { id: row.id },
    data: { usedAt: new Date(), consumedById: session.user.id },
  });

  const token = signElevationToken({
    sub: session.user.id,
    grants: [...DEFAULT_ELEVATION_GRANTS],
    exp: Math.floor(Date.now() / 1000) + 5 * 60,
  });

  return NextResponse.json({
    elevationToken: token,
    expiresInSeconds: 300,
  });
}
