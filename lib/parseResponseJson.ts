/**
 * Parse a fetch Response body as JSON without throwing.
 * Empty bodies and non-JSON responses return null (avoids JSON.parse on HTML/text error pages).
 */
export async function parseResponseJson<T = unknown>(res: Response): Promise<T | null> {
  const text = await res.text();
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

/** Use API `{ message }` when present; otherwise a status-based fallback. */
export function errorMessageFromJson(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "message" in data) {
    const m = (data as { message: unknown }).message;
    if (typeof m === "string" && m.length > 0) return m;
  }
  return fallback;
}
