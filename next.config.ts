import type { NextConfig } from "next";

// The Content-Security-Policy is set per-request in proxy.ts (it carries a
// per-request script nonce). These are the static security headers.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // `preload` declares eligibility for the browser HSTS preload list. It's the
  // header prerequisite; actual inclusion requires submitting the apex domain at
  // hstspreload.org (matters once on a custom domain — *.vercel.app is already
  // preloaded by Vercel). Safe to assert now: max-age is 2y with includeSubDomains.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  // AI import uploads (diagram images / PDFs) travel through a server action.
  experimental: { serverActions: { bodySizeLimit: "16mb" } },
  // A stray lockfile in the home directory makes Next infer the wrong
  // workspace root; pin it to this project.
  turbopack: { root: __dirname },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
