import { NextRequest, NextResponse } from "next/server";
import { searchPCParts } from "@/lib/pcPartsSearch";
import { requireApiAnyPermission } from "@/lib/apiAuth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

type CachedSearchPayload = {
  results: Awaited<ReturnType<typeof searchPCParts>>;
  cachedAt: string;
};

function buildCacheKey(q: string, category?: string) {
  return `components-search:${(category ?? "all").toLowerCase()}:${q.toLowerCase()}`;
}

export async function GET(req: NextRequest) {
  const auth = await requireApiAnyPermission([PERMISSIONS.componentsSearch]);
  if (!auth.ok) return auth.response;

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const category = req.nextUrl.searchParams.get("category")?.trim() ?? undefined;

  if (q.length < 2) {
    return NextResponse.json({ message: "q is required and must be at least 2 characters" }, { status: 400 });
  }

  const cacheKey = buildCacheKey(q, category);
  const cached = await prisma.setting.findUnique({ where: { key: cacheKey } });
  if (cached?.value) {
    try {
      const parsed = JSON.parse(cached.value) as CachedSearchPayload;
      if (Array.isArray(parsed.results) && Date.now() - new Date(parsed.cachedAt).getTime() < CACHE_TTL_MS) {
        return NextResponse.json({ results: parsed.results, cached: true });
      }
    } catch {
      // ignore cache parse errors and continue with live search
    }
  }

  const results = await searchPCParts(q, category);
  const payload: CachedSearchPayload = {
    results,
    cachedAt: new Date().toISOString(),
  };

  await prisma.setting.upsert({
    where: { key: cacheKey },
    update: { value: JSON.stringify(payload) },
    create: { key: cacheKey, value: JSON.stringify(payload) },
  });

  return NextResponse.json({ results, cached: false });
}
