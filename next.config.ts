import type { NextConfig } from "next";

// [SECURITY] HTTP security headers applied to every response.
//   • Content-Security-Policy: scripts, styles and API calls may only come from
//     our own origin; images additionally from OpenStreetMap's tile servers (the
//     map) and blob:/data: (local photo previews). This blocks injected
//     third-party scripts and data exfiltration to other hosts.
//   • frame-ancestors 'none' + X-Frame-Options: no clickjacking via iframes.
//   • X-Content-Type-Options nosniff: browsers never reinterpret an uploaded
//     image as HTML or script.
//   • Permissions-Policy: microphone (voice notes), camera (photos) and
//     geolocation ("use my location") are allowed for our own origin only.
//   • Strict-Transport-Security: HTTPS only (Cloud Run serves HTTPS by default).
// 'unsafe-inline' for scripts is needed by Next.js's inline bootstrap script;
// 'unsafe-eval' is added in development only (React dev tooling).
const isDev = process.env.NODE_ENV !== "production";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data: https://*.tile.openstreetmap.org",
  "media-src 'self' blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "microphone=(self), camera=(self), geolocation=(self)" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  // [GOOGLE SERVICES][EFFICIENCY] Self-contained server bundle for the Google
  // Cloud Run container: small image, fast cold starts.
  output: "standalone",
  // Bundle the seed file into the server output.
  outputFileTracingIncludes: { "/**": ["./seed/**"] },
  // [SECURITY] Don't advertise the framework in response headers.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
