import { createHmac, timingSafeEqual } from "crypto";
import { ALL_PERMISSION_KEYS, PERMISSIONS, type PermissionKey } from "@/lib/permissions";

const ISS = "elevation-v1";

export type ElevationPayload = {
  iss: typeof ISS;
  sub: string;
  grants: PermissionKey[];
  exp: number;
};

function secret(): string {
  const base = process.env.NEXTAUTH_SECRET ?? "";
  return `${base}:elevation`;
}

export function signElevationToken(payload: Omit<ElevationPayload, "iss" | "exp"> & { exp?: number }): string {
  const exp = payload.exp ?? Math.floor(Date.now() / 1000) + 5 * 60;
  const full: ElevationPayload = {
    iss: ISS,
    sub: payload.sub,
    grants: payload.grants,
    exp,
  };
  const body = Buffer.from(JSON.stringify(full), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyElevationToken(token: string): { ok: true; payload: ElevationPayload } | { ok: false } {
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false };
  const [body, sig] = parts;
  try {
    const expected = createHmac("sha256", secret()).update(body).digest("base64url");
    const a = Buffer.from(sig, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false };
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ElevationPayload;
    if (payload.iss !== ISS || !payload.sub || !Array.isArray(payload.grants) || typeof payload.exp !== "number") {
      return { ok: false };
    }
    if (payload.exp * 1000 < Date.now()) return { ok: false };
    return { ok: true, payload };
  } catch {
    return { ok: false };
  }
}

/** Permissions that allow a user to act as an approver/supervisor. */
export const APPROVER_PERMISSIONS: PermissionKey[] = [
  PERMISSIONS.elevationApprovalsResolve,
  PERMISSIONS.elevationSupervisorApprove,
];

/** Grants issued after supervisor/code/approval — covers all restricted routes. */
export const DEFAULT_ELEVATION_GRANTS: PermissionKey[] = [...ALL_PERMISSION_KEYS];
