/**
 * Next.js 16 proxy (formerly middleware): sets a per-request Content-Security-
 * Policy with a script nonce (real XSS containment — inline scripts must carry
 * the nonce, external scripts must come from an allowlisted origin), and in
 * Clerk mode attaches the verified session to every matched request.
 *
 * Route protection here is UX only. The security boundary is
 * requireEngagementContext in every page/action/handler.
 */
import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";

const hasClerkKeys = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);

// Clerk loads its frontend script + Cloudflare Turnstile and calls its API.
const CLERK_HOSTS = "https://*.clerk.accounts.dev https://*.clerk.com https://challenges.cloudflare.com";
const CLERK_CONNECT = "https://*.clerk.accounts.dev https://*.clerk.com https://clerk-telemetry.com";

function buildCsp(nonce: string): string {
  // React uses eval() for debugging in DEV only ("never in production mode"),
  // so 'unsafe-eval' is dev-only — production stays strict.
  const devEval = process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'";
  return [
    "default-src 'self'",
    // No 'unsafe-inline' for scripts: inline scripts need the nonce (Next adds
    // it to its own bootstrap scripts), external scripts must match an origin.
    `script-src 'self' 'nonce-${nonce}'${devEval} ${CLERK_HOSTS}`,
    // Framework/Clerk inject inline styles; style injection is low-risk.
    "style-src 'self' 'unsafe-inline'",
    // The app ships no external images of its own (charts are inline SVG); the
    // only remote images are Clerk avatars from img.clerk.com (matches
    // *.clerk.com). Scoped to the Clerk hosts instead of a blanket `https:`.
    `img-src 'self' data: ${CLERK_HOSTS}`,
    "font-src 'self' data:",
    `connect-src 'self' ${CLERK_CONNECT}`,
    "worker-src 'self' blob:",
    `frame-src 'self' ${CLERK_HOSTS}`,
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

/** Attach the CSP to the request (so Next picks up the nonce) and response. */
function withCsp(req: NextRequest): NextResponse {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("content-security-policy", csp);
  return res;
}

export default hasClerkKeys
  ? clerkMiddleware(async (_auth, req) => withCsp(req))
  : (req: NextRequest) => withCsp(req);

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
