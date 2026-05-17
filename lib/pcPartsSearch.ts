import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseResponseJson } from "@/lib/parseResponseJson";

const execFileAsync = promisify(execFile);

export type PCComponent = {
  name: string;
  brand: string;
  model?: string;
  category: string;
  specs: Record<string, string>;
  imageUrl?: string;
  barcode?: string;
  externalUrl?: string;
  suggestedPrice?: number;
  sourcePriceText?: string;
};

const PYTHON_PCPARTPICKER_TIMEOUT_MS = 12000;
const IMAGE_TIMEOUT_MS = 6000;
const imageCache = new Map<string, string | null>();

const categoryAliases: Record<string, string> = {
  cpu: "cpu",
  gpu: "gpu",
  ram: "ram",
  storage: "storage",
  motherboard: "motherboard",
  psu: "psu",
  case: "case",
  cooler: "cooler",
  monitor: "monitor",
  keyboard: "keyboard",
  mouse: "mouse",
};

function normalizeCategory(category?: string) {
  if (!category) return undefined;
  const normalized = category.trim().toLowerCase();
  return categoryAliases[normalized] ?? normalized;
}

function imageFallbackByCategory(category: string) {
  if (category === "gpu") return "/placeholders/gpu.svg";
  if (category === "cpu") return "/placeholders/cpu.svg";
  return "/placeholders/component.svg";
}

function categoryImageHint(category: string) {
  if (category === "gpu") return "graphics card";
  if (category === "cpu") return "processor";
  if (category === "ram") return "memory module";
  if (category === "storage") return "ssd";
  if (category === "motherboard") return "motherboard";
  if (category === "psu") return "power supply";
  return "computer hardware";
}

async function fetchWikipediaImage(searchTerm: string): Promise<string | undefined> {
  try {
    const params = new URLSearchParams({
      action: "query",
      generator: "search",
      gsrsearch: searchTerm,
      gsrlimit: "5",
      prop: "pageimages",
      piprop: "thumbnail",
      pithumbsize: "360",
      format: "json",
      utf8: "1",
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
    const response = await fetch(`https://en.wikipedia.org/w/api.php?${params.toString()}`, {
      signal: controller.signal,
      headers: { "User-Agent": "StorePOS/1.0 (free image fetcher)" },
    });
    clearTimeout(timeout);
    if (!response.ok) return undefined;
    const data = await parseResponseJson<{
      query?: { pages?: Record<string, { thumbnail?: { source?: string } }> };
    }>(response);
    if (!data) return undefined;
    const pages = Object.values(data.query?.pages ?? {});
    const image = pages.find((page) => typeof page.thumbnail?.source === "string")?.thumbnail?.source;
    return image;
  } catch {
    return undefined;
  }
}

async function fetchFreeImageForComponent(component: PCComponent): Promise<string | undefined> {
  const cacheKey = `${component.category}|${component.brand}|${component.model ?? ""}|${component.name}`.toLowerCase();
  if (imageCache.has(cacheKey)) {
    return imageCache.get(cacheKey) ?? undefined;
  }

  const hint = categoryImageHint(component.category);
  const primary = [component.brand, component.model ?? component.name, hint].filter(Boolean).join(" ");
  const secondary = `${component.name} ${hint}`;

  const image = (await fetchWikipediaImage(primary)) ?? (await fetchWikipediaImage(secondary));
  imageCache.set(cacheKey, image ?? null);
  return image;
}

async function searchWithPythonPcPartPicker(query: string, category?: string): Promise<PCComponent[]> {
  try {
    const scriptPath = `${process.cwd()}/scripts/pcpartpicker_search.py`;
    const { stdout } = await execFileAsync(
      "/usr/bin/python3",
      [scriptPath, "--query", query, "--category", category ?? "", "--limit", "20"],
      { timeout: PYTHON_PCPARTPICKER_TIMEOUT_MS },
    );

    const parsed = JSON.parse(stdout) as { results?: PCComponent[] };
    if (!parsed || !Array.isArray(parsed.results)) return [];
    const baseResults = parsed.results
      .filter((item) => item && typeof item.name === "string" && item.name.trim().length > 0)
      .slice(0, 20);

    const withImages = await Promise.all(
      baseResults.map(async (item) => {
        if (item.imageUrl) return item;
        const freeImage = await fetchFreeImageForComponent(item);
        return {
          ...item,
          imageUrl: freeImage ?? imageFallbackByCategory(item.category),
        };
      }),
    );

    return withImages;
  } catch {
    return [];
  }
}

export async function searchPCParts(query: string, category?: string): Promise<PCComponent[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const normalizedCategory = normalizeCategory(category);
  return await searchWithPythonPcPartPicker(trimmed, normalizedCategory);
}
