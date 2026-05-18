import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// needsSetup = store has never been configured (no storeName saved yet)
export async function GET() {
  const setting = await prisma.setting.findUnique({ where: { key: "storeName" } });
  return NextResponse.json({ needsSetup: !setting?.value });
}

// Save store configuration (called by setup wizard after first login)
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    storeName?: string;
    storePhone?: string;
    storeLogo?: string;
  };

  const { storeName, storePhone, storeLogo } = body;

  if (!storeName?.trim()) {
    return NextResponse.json({ message: "اسم المتجر مطلوب" }, { status: 400 });
  }

  await prisma.setting.upsert({
    where: { key: "storeName" },
    update: { value: storeName.trim() },
    create: { key: "storeName", value: storeName.trim() },
  });

  if (storePhone?.trim()) {
    await prisma.setting.upsert({
      where: { key: "storePhone" },
      update: { value: storePhone.trim() },
      create: { key: "storePhone", value: storePhone.trim() },
    });
  }

  if (storeLogo && storeLogo.startsWith("data:image/")) {
    await prisma.setting.upsert({
      where: { key: "storeLogo" },
      update: { value: storeLogo },
      create: { key: "storeLogo", value: storeLogo },
    });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
