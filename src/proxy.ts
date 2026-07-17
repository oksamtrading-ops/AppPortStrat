/**
 * Next.js 16 proxy (formerly middleware). In Clerk mode, clerkMiddleware
 * attaches the verified session to every matched request. In dev mode (local
 * only — mode.ts is fail-closed) requests pass through and the cookie-based
 * dev session takes over in the server components.
 *
 * This is route protection UX only. The security boundary is
 * requireEngagementContext in every page/action/handler.
 */
import { clerkMiddleware } from "@clerk/nextjs/server";

const hasClerkKeys = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);

const passthrough = () => undefined;

export default hasClerkKeys ? clerkMiddleware() : passthrough;

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
