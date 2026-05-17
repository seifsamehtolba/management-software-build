import { parseResponseJson } from "@/lib/parseResponseJson";

type EtaSubmitInput = {
  saleId: string;
  invoicePayload?: Record<string, unknown>;
};

type EtaSubmitResult =
  | { ok: true; reference: string; raw: unknown }
  | { ok: false; message: string; retriable: boolean; raw?: unknown };

function getTimeoutMs() {
  const value = Number(process.env.ETA_TIMEOUT_MS ?? "10000");
  return Number.isFinite(value) && value > 0 ? value : 10000;
}

export async function submitEtaInvoice(input: EtaSubmitInput): Promise<EtaSubmitResult> {
  const url = process.env.ETA_API_URL;
  const apiKey = process.env.ETA_API_KEY;

  if (!url || !apiKey) {
    return {
      ok: false,
      message: "ETA credentials are not configured",
      retriable: false,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getTimeoutMs());
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        saleId: input.saleId,
        invoicePayload: input.invoicePayload ?? {},
      }),
      signal: controller.signal,
    });

    const payload: unknown = await parseResponseJson(response);

    if (!response.ok) {
      return {
        ok: false,
        message: `ETA submit failed: ${response.status}`,
        retriable: response.status >= 500 || response.status === 429,
        raw: payload,
      };
    }

    let reference = `ETA-${Date.now()}`;
    if (
      typeof payload === "object" &&
      payload !== null &&
      "reference" in payload &&
      typeof (payload as Record<string, unknown>).reference === "string"
    ) {
      reference = (payload as Record<string, unknown>).reference as string;
    }

    return { ok: true, reference, raw: payload };
  } catch (error) {
    const err = error instanceof Error ? error : new Error("ETA submit network error");
    return {
      ok: false,
      message: err.message,
      retriable: true,
    };
  } finally {
    clearTimeout(timeout);
  }
}
