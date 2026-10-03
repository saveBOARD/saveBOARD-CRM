import { NextResponse, type NextRequest } from "next/server";
import { authStatus } from "@/server/auth/config";

// Quick check before every request (Next.js "proxy", formerly middleware): no sign-in cookie, no page.
// It only looks for the cookie; the real check (valid session + active CRM profile) is requireUser() in the app.

const PUBLIC = ["/signin", "/api/auth"];

function hasSessionCookie(req: NextRequest) {
  return req.cookies.getAll().some((c) => /^(__Secure-)?authjs\.session-token(\.\d+)?$/.test(c.name));
}

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const isPublic = PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (isPublic) {
    // Without sign-in settings the Auth.js endpoints cannot work: keep them closed too.
    if (pathname.startsWith("/api/auth") && !authStatus().configured) {
      return NextResponse.json({ error: "Sign-in is not set up" }, { status: 503 });
    }
    return NextResponse.next();
  }

  if (!authStatus().configured || !hasSessionCookie(req)) {
    const url = new URL("/signin", req.url);
    if (pathname !== "/") url.searchParams.set("callbackUrl", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Everything except Next.js internals (build files, images, dev live-reload) and the public images/icons.
  matcher: ["/((?!_next/|favicon.ico|icon.png|apple-icon.png|logo.png|logo-on-dark.png).*)"],
};
