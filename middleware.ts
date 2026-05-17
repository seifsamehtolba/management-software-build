import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

const PUBLIC_PATHS = ["/setup", "/login", "/api/setup", "/api/auth", "/_next", "/favicon", "/public"];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname.startsWith(p));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();

  // Check if app needs first-run setup
  const setupRes = await fetch(new URL("/api/setup", req.url));
  if (setupRes.ok) {
    const { needsSetup } = (await setupRes.json()) as { needsSetup: boolean };
    if (needsSetup) {
      return NextResponse.redirect(new URL("/setup", req.url));
    }
  }

  // Require authentication for all other routes
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|public).*)"],
};
