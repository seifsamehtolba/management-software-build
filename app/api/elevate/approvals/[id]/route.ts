import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

/** Requester polls this — receives elevation token once when approved */
export async function GET(_: Request, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const row = await prisma.elevationApproval.findUnique({
    where: { id },
    include: {
      requester: { select: { id: true, name: true, email: true } },
    },
  });

  if (!row) {
    return NextResponse.json({ message: "Not found" }, { status: 404 });
  }

  const isRequester = row.requesterId === session.user.id;

  if (!isRequester) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }

  if (row.status === "DENIED") {
    return NextResponse.json({ status: "DENIED", message: "Request was denied" });
  }

  if (row.status === "PENDING") {
    return NextResponse.json({ status: "PENDING" });
  }

  if (row.status === "APPROVED" && row.issuedToken) {
    const token = row.issuedToken;
    await prisma.elevationApproval.update({
      where: { id },
      data: { issuedToken: null },
    });
    return NextResponse.json({
      status: "APPROVED",
      elevationToken: token,
      expiresInSeconds: 300,
    });
  }

  return NextResponse.json({ status: row.status, message: "Token already consumed — repeat approval if needed" });
}
