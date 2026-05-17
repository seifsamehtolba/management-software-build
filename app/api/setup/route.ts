import { NextRequest, NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { ALL_PERMISSION_KEYS } from "@/lib/permissions";

// Check if setup is needed (no users exist)
export async function GET() {
  const count = await prisma.user.count();
  return NextResponse.json({ needsSetup: count === 0 });
}

// Complete setup: create owner account + store settings
export async function POST(req: NextRequest) {
  // Guard: only works when no users exist
  const count = await prisma.user.count();
  if (count > 0) {
    return NextResponse.json({ message: "Setup already completed" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    email?: string;
    password?: string;
    storeName?: string;
    storePhone?: string;
  };

  const { name, email, password, storeName, storePhone } = body;

  if (!name?.trim() || !email?.trim() || !password || password.length < 6) {
    return NextResponse.json(
      { message: "Name, email, and a password (min 6 characters) are required" },
      { status: 400 },
    );
  }

  const passwordHash = await hash(password, 12);

  const ownerPermissions = Array.from(ALL_PERMISSION_KEYS);

  await prisma.user.create({
    data: {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      passwordHash,
      role: "OWNER" as never,
      permissions: ownerPermissions,
      isActive: true,
    },
  });

  // Upsert store settings if provided
  if (storeName?.trim()) {
    await prisma.setting.upsert({
      where: { key: "storeName" },
      update: { value: storeName.trim() },
      create: { key: "storeName", value: storeName.trim() },
    });
  }
  if (storePhone?.trim()) {
    await prisma.setting.upsert({
      where: { key: "storePhone" },
      update: { value: storePhone.trim() },
      create: { key: "storePhone", value: storePhone.trim() },
    });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
