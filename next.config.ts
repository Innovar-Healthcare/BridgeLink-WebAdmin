import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import type { NextConfig } from "next";
import packageJson from "./package.json";

function getGitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    // Fallback for environments without git: read directly from .git directory
    try {
      const head = fs.readFileSync(path.join(__dirname, ".git", "HEAD"), "utf8").trim();
      // HEAD is either "ref: refs/heads/<branch>" or a bare SHA (detached)
      if (head.startsWith("ref: ")) {
        const refPath = path.join(__dirname, ".git", head.slice(5));
        return fs.readFileSync(refPath, "utf8").trim().slice(0, 7);
      }
      return head.slice(0, 7);
    } catch {
      return "dev";
    }
  }
}

/**
 * Read the installed monaco-editor version so the client loader path
 * (lib/monaco-loader.ts → /monaco/<version>/vs) matches the assets vendored by
 * scripts/copy-monaco.mjs. Both derive from the same package.json, so the served
 * path and the copied assets can never drift.
 */
function getMonacoVersion(): string {
  try {
    const pkgPath = path.join(__dirname, "node_modules", "monaco-editor", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version?: string };
    return pkg.version ?? "";
  } catch {
    return "";
  }
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: packageJson.version,
    NEXT_PUBLIC_GIT_SHA: getGitSha(),
    NEXT_PUBLIC_BETA_MODE: process.env.BETA_MODE ?? "",
    // Installed monaco-editor version — drives the self-hosted loader path in
    // lib/monaco-loader.ts; kept in sync with scripts/copy-monaco.mjs.
    NEXT_PUBLIC_MONACO_VERSION: getMonacoVersion(),
  },
  reactStrictMode: true,
  output: "standalone",
  // The BridgeLink hop's scoped-TLS dispatcher (lib/bl-dispatcher.ts) loads
  // `undici` via a bundler-ignored dynamic import so it never lands in the
  // client bundle. The trade-off is that Next's file tracer can't see the
  // import, so undici is omitted from the standalone output and the proxy
  // crashes at runtime with "Cannot find package 'undici'". Force
  // it into the trace for every route that calls fetchBridgeLink.
  outputFileTracingIncludes: {
    // The custom server.ts (import next from "next" → next().prepare()) triggers
    // Next's config loader at boot, which calls loadWebpackHook() →
    // require.resolve("next/dist/compiled/webpack/webpack-lib"). Turbopack's file
    // tracer drops next/dist/compiled/webpack from the standalone output, and our
    // custom server.js overwrites Next's generated standalone server.js — so the
    // __NEXT_PRIVATE_STANDALONE_CONFIG guard that would let config.js swallow the
    // missing-module error is never set, and the server crashes on boot with
    // "Cannot find module '.../webpack/webpack-lib'". Force the whole compiled/webpack
    // dir into the trace so the resolve succeeds. Server-only (never a client chunk),
    // so no CSP-eval impact. Same class of tracer gap as the undici workaround below
    //.
    //
    // loadWebpackHook aliases the whole next/dist/compiled/webpack/* set plus
    // next/dist/compiled/@babel/runtime — both are dropped by the tracer, so both
    // must be force-included. scripts/smoke-standalone.sh boots the packaged artifact
    // in CI and will fail if a future Next upgrade adds another aliased module here.
    "/**/*": [
      "./node_modules/next/dist/compiled/webpack/**/*",
      "./node_modules/next/dist/compiled/@babel/runtime/**/*",
    ],
    "/api/proxy/[...path]": ["./node_modules/undici/**/*"],
    "/api/auth/whoami": ["./node_modules/undici/**/*"],
    "/api/ssl/import-trusted-pem": ["./node_modules/undici/**/*"],
  },
  turbopack: {
    root: path.resolve(__dirname),
  },
  async headers() {
    const securityHeaders = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      // Strict-Transport-Security is intentionally NOT set here: next.config
      // headers() is evaluated at build time and baked into the routes manifest,
      // so it cannot tell whether a given deployment serves HTTPS. Emitting HSTS
      // on a plaintext deployment can pin sibling HTTP services on the domain
      //. HSTS is instead set per-request in server.ts, gated on a
      // secure context (mirror of lib/cookie-security.ts:isSecureContext).
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ];

    // Report-only CSP: surfaces violations in the browser console without
    // blocking anything. Omitted in development — Next.js Fast Refresh uses
    // eval and websockets that would generate noise. Follow-up ticket: switch
    // script-src to 'nonce-...' enforcement once nonce infrastructure is in place.
    if (process.env.NODE_ENV === "production") {
      const cspDirectives = [
        "default-src 'self'",
        // Next.js App Router and the theme bootstrap (app/layout.tsx) inject
        // inline scripts; tighten to nonces in the follow-up enforcement pass.
        "script-src 'self' 'unsafe-inline'",
        // next/font and Tailwind inject inline <style> elements.
        "style-src 'self' 'unsafe-inline'",
        // Monaco editor loads workers via blob URLs.
        "worker-src 'self' blob:",
        // Browser only contacts same-origin proxies; Anthropic calls are server-side.
        "connect-src 'self'",
        // Icons, data-URI thumbnails, and blob attachment previews.
        "img-src 'self' data: blob:",
        // Self-hosted Geist fonts; data: covers inlined font faces.
        "font-src 'self' data:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        // Mirrors X-Frame-Options: DENY above.
        "frame-ancestors 'none'",
        "frame-src 'self'",
        // Report violations to our sink so they are visible in operator logs.
        // report-uri: legacy format, widest browser support.
        // report-to: modern Reporting API (requires Reporting-Endpoints header below).
        "report-uri /api/csp-report",
        "report-to csp-endpoint",
      ];
      securityHeaders.push(
        {
          key: "Reporting-Endpoints",
          value: `csp-endpoint="/api/csp-report"`,
        },
        {
          key: "Content-Security-Policy-Report-Only",
          value: cspDirectives.join("; "),
        }
      );
    }

    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
