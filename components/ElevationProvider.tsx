"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSession } from "next-auth/react";
import { Button, Card, Input } from "@/components/ui/primitives";
import { errorMessageFromJson, parseResponseJson } from "@/lib/parseResponseJson";

type ElevationContextValue = {
  /** Abort pending elevation prompt */
  cancelElevation: () => void;
};

const ElevationContext = createContext<ElevationContextValue | null>(null);

export function useElevationContext() {
  return useContext(ElevationContext);
}

function shouldIntercept(url: string): boolean {
  if (!url.includes("/api/")) return false;
  if (url.includes("/api/elevate/") || url.includes("/api/auth/")) return false;
  return true;
}

export function ElevationProvider({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const resolveRef = useRef<((token: string) => void) | null>(null);
  const rejectRef = useRef<((err: Error) => void) | null>(null);

  const [open, setOpen] = useState(false);
  const [requiredPermissions, setRequiredPermissions] = useState<string[]>([]);
  const [tab, setTab] = useState<"supervisor" | "code" | "approval">("supervisor");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [supervisorEmail, setSupervisorEmail] = useState("");
  const [supervisorPassword, setSupervisorPassword] = useState("");
  const [codeDigits, setCodeDigits] = useState("");
  const [approvalSummary, setApprovalSummary] = useState("");
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanupPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const cancelElevation = useCallback(() => {
    cleanupPolling();
    setOpen(false);
    rejectRef.current?.(new Error("Elevation cancelled"));
    resolveRef.current = null;
    rejectRef.current = null;
    setApprovalId(null);
    setError("");
  }, [cleanupPolling]);

  const finishWithToken = useCallback(
    (token: string) => {
      cleanupPolling();
      setOpen(false);
      resolveRef.current?.(token);
      resolveRef.current = null;
      rejectRef.current = null;
      setApprovalId(null);
      setError("");
    },
    [cleanupPolling],
  );

  useEffect(() => {
    if (status !== "authenticated") return;

    const orig = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof Request
            ? input.url
            : input.href;

      const headersInit = init?.headers;
      const hasElev =
        headersInit instanceof Headers
          ? headersInit.has("x-elevation-token")
          : !!(headersInit && typeof headersInit === "object" && !Array.isArray(headersInit) && "x-elevation-token" in headersInit);

      let retryClone: Request | null = null;
      if (input instanceof Request) {
        try {
          retryClone = input.clone();
        } catch {
          retryClone = null;
        }
      }

      const first = await orig(input, init);
      if (first.status !== 403 || !shouldIntercept(url) || hasElev) {
        return first;
      }

      const payload = await parseResponseJson<{ code?: string; requiredPermissions?: string[] }>(first.clone());
      if (!payload || payload.code !== "ELEVATION_REQUIRED") {
        return first;
      }

      setRequiredPermissions(payload.requiredPermissions ?? []);
      setTab("supervisor");
      setError("");
      setOpen(true);

      let token: string;
      try {
        token = await new Promise<string>((resolve, reject) => {
          resolveRef.current = resolve;
          rejectRef.current = reject;
        });
      } catch {
        return first;
      }

      const mergedHeaders = new Headers(init?.headers ?? {});
      mergedHeaders.set("X-Elevation-Token", token);

      if (retryClone) {
        const h = new Headers(retryClone.headers);
        h.set("X-Elevation-Token", token);
        return orig(new Request(retryClone, { headers: h }));
      }

      return orig(input, { ...init, headers: mergedHeaders });
    };

    return () => {
      window.fetch = orig;
    };
  }, [status]);

  const submitSupervisor = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/elevate/supervisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supervisorEmail: supervisorEmail.trim(),
          supervisorPassword: supervisorPassword,
        }),
      });
      const data = await parseResponseJson<{ elevationToken?: string; message?: string }>(res);
      if (!res.ok) {
        setError(errorMessageFromJson(data, `Could not verify supervisor (${res.status})`));
        return;
      }
      if (data?.elevationToken) {
        setSupervisorPassword("");
        finishWithToken(data.elevationToken);
      }
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/elevate/code/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: codeDigits }),
      });
      const data = await parseResponseJson<{ elevationToken?: string; message?: string }>(res);
      if (!res.ok) {
        setError(errorMessageFromJson(data, `Invalid code (${res.status})`));
        return;
      }
      if (data?.elevationToken) {
        setCodeDigits("");
        finishWithToken(data.elevationToken);
      }
    } finally {
      setBusy(false);
    }
  };

  const startApproval = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/elevate/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: approvalSummary,
          routeHint: typeof window !== "undefined" ? window.location.pathname : "",
        }),
      });
      const data = await parseResponseJson<{ id?: string; message?: string }>(res);
      if (!res.ok) {
        setError(errorMessageFromJson(data, `Could not create request (${res.status})`));
        return;
      }
      if (data?.id) {
        setApprovalId(data.id);
        const approvalId = data.id;
        pollRef.current = setInterval(async () => {
          const st = await fetch(`/api/elevate/approvals/${approvalId}`);
          const j = await parseResponseJson<{ status?: string; elevationToken?: string; message?: string }>(st);
          if (!j) return;
          if (j.status === "APPROVED" && j.elevationToken) {
            cleanupPolling();
            finishWithToken(j.elevationToken);
          }
          if (j.status === "DENIED") {
            cleanupPolling();
            setError(j.message ?? "Request denied");
          }
        }, 2000);
      }
    } finally {
      setBusy(false);
    }
  };

  const ctx = useMemo(() => ({ cancelElevation }), [cancelElevation]);

  if (status === "unauthenticated") {
    return <>{children}</>;
  }

  return (
    <ElevationContext.Provider value={ctx}>
      {children}
      {open ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="elevation-title"
        >
          <Card className="w-full max-w-md p-5 shadow-2xl">
            <h2 id="elevation-title" className="text-lg font-semibold">
              Permission approval required
            </h2>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              This action needs: {requiredPermissions.join(", ")}. Choose how to continue.
            </p>

            <div className="mt-3 flex flex-wrap gap-1 border-b pb-2" style={{ borderColor: "var(--border)" }}>
              {(
                [
                  ["supervisor", "Supervisor login"],
                  ["code", "One-time code"],
                  ["approval", "In-app approval"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setTab(k);
                    setError("");
                  }}
                  className="rounded-md px-3 py-1.5 text-sm font-medium"
                  style={
                    tab === k
                      ? { background: "var(--accent)", color: "var(--accent-foreground)" }
                      : { background: "var(--surface-muted)" }
                  }
                >
                  {label}
                </button>
              ))}
            </div>

            {error ? (
              <p className="mt-3 text-sm text-rose-600" role="alert">
                {error}
              </p>
            ) : null}

            {tab === "supervisor" ? (
              <div className="mt-4 space-y-2">
                <label className="block text-sm">
                  <span className="text-zinc-600">Supervisor email</span>
                  <Input
                    className="mt-1 w-full"
                    value={supervisorEmail}
                    onChange={(e) => setSupervisorEmail(e.target.value)}
                    autoComplete="username"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-zinc-600">Supervisor password</span>
                  <Input
                    type="password"
                    className="mt-1 w-full"
                    value={supervisorPassword}
                    onChange={(e) => setSupervisorPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                </label>
                <Button type="button" className="mt-2 w-full" disabled={busy} onClick={() => void submitSupervisor()}>
                  {busy ? "Verifying…" : "Confirm & continue"}
                </Button>
              </div>
            ) : null}

            {tab === "code" ? (
              <div className="mt-4 space-y-2">
                <p className="text-sm" style={{ color: "var(--muted)" }}>
                  Enter the 6-digit code an admin gave you from Team → Elevation code.
                </p>
                <Input
                  inputMode="numeric"
                  className="w-full tracking-widest"
                  value={codeDigits}
                  onChange={(e) => setCodeDigits(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                />
                <Button type="button" className="w-full" disabled={busy} onClick={() => void submitCode()}>
                  {busy ? "Checking…" : "Use code"}
                </Button>
              </div>
            ) : null}

            {tab === "approval" ? (
              <div className="mt-4 space-y-2">
                <p className="text-sm" style={{ color: "var(--muted)" }}>
                  Request that an admin approves in <strong>Team</strong>. This page will continue automatically
                  when they approve.
                </p>
                <label className="block text-sm">
                  <span className="text-zinc-600">What are you trying to do?</span>
                  <Input
                    className="mt-1 w-full"
                    value={approvalSummary}
                    onChange={(e) => setApprovalSummary(e.target.value)}
                    disabled={!!approvalId}
                    placeholder="e.g. Delete customer X, run quote expiry"
                  />
                </label>
                {!approvalId ? (
                  <Button type="button" className="w-full" disabled={busy} onClick={() => void startApproval()}>
                    {busy ? "Submitting…" : "Request approval"}
                  </Button>
                ) : (
                  <p className="text-sm text-amber-800">Waiting for approval… (request {approvalId.slice(0, 8)}…)</p>
                )}
              </div>
            ) : null}

            <Button type="button" variant="secondary" className="mt-4 w-full" onClick={cancelElevation}>
              Cancel
            </Button>
          </Card>
        </div>
      ) : null}
    </ElevationContext.Provider>
  );
}
