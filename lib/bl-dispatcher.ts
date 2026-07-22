/**
 * Scoped TLS for the BridgeLink hop /.
 *
 * BridgeLink servers commonly present a self-signed TLS certificate, so the
 * WebAdmin→BridgeLink server-to-server hop must tolerate them. The previous
 * approach set `NODE_TLS_REJECT_UNAUTHORIZED=0` at module load, which disabled
 * certificate verification process-wide — including the Anthropic SDK and OIDC
 * discovery, which are public-internet calls that must always verify.
 *
 * Instead, we relax verification with a per-request undici dispatcher applied
 * ONLY to fetches aimed at the (already allowlisted) BridgeLink host. The rest
 * of the process keeps verifying certificates by default.
 *
 * Next 16's global `fetch` is undici-backed and forwards the `dispatcher` init
 * option to undici, so we keep using the global `fetch` symbol — this also
 * means unit tests that mock `globalThis.fetch` continue to intercept BL calls.
 *
 * Why the dynamic imports: this module is transitively reachable from a client
 * bundle (the login page imports `@/plugins`, whose SSL plugin registers the
 * import-pem route handler that lives here). `undici` and `node:fs` use
 * `node:`-scheme imports that a browser bundle can't resolve. Loading them via
 * bundler-ignored dynamic imports keeps them out of every bundle; they resolve
 * at runtime in Node, which is the only place fetchBridgeLink is ever invoked.
 *
 * ## Opt-in CA pinning
 *
 * Set `BRIDGELINK_CA_CERT` to the absolute path of a PEM file containing the CA
 * (or self-signed cert) that signed the BridgeLink server's TLS certificate.
 * When set, the dispatcher verifies the BL hop against that CA with full cert
 * checking enabled (`rejectUnauthorized: true`). This is the recommended
 * production posture when the BL server certificate is known in advance.
 *
 * Without `BRIDGELINK_CA_CERT` the dispatcher accepts any certificate on the BL
 * hop (self-signed or otherwise), which is the backwards-compatible default for
 * installs where the cert may change. A startup warning is emitted either way.
 *
 * Fingerprint-level pinning via a custom `checkServerIdentity` function is a
 * natural next step if per-cert pinning is needed beyond CA pinning.
 */

import type { Dispatcher } from "undici";

import { logStartupWarn, logServerError } from "./server-log";

/** Lazily-created shared dispatcher, created once per process. */
let dispatcherPromise: Promise<Dispatcher> | undefined;

async function buildDispatcher(): Promise<Dispatcher> {
  const { Agent } = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ "undici");

  const caCertPath = process.env.BRIDGELINK_CA_CERT;
  if (caCertPath) {
    const { readFileSync } = await import(
      /* webpackIgnore: true */ /* turbopackIgnore: true */ "node:fs"
    );
    let ca: Buffer;
    try {
      ca = readFileSync(caCertPath);
    } catch (err) {
      // Fail closed: pinning was explicitly requested, so we never silently
      // fall back to relaxed verification. Log a specific message so the cause
      // is obvious (the proxy otherwise reports a generic "upstream failed").
      logServerError(
        "tls",
        `BRIDGELINK_CA_CERT is set but the file could not be read (${caCertPath}). ` +
          "The BridgeLink hop is pinned to this CA, so requests will fail until the file " +
          "is readable. Fix the path or permissions (the container runs as UID 1000).",
        err
      );
      throw new Error(`Unable to read BRIDGELINK_CA_CERT at ${caCertPath}`);
    }
    logStartupWarn(
      "tls-pinned",
      `TLS verification PINNED to BRIDGELINK_CA_CERT (${caCertPath}) for the BridgeLink hop.`
    );
    return new Agent({ connect: { ca, rejectUnauthorized: true } });
  }

  logStartupWarn(
    "tls-relaxed",
    "TLS certificate verification is RELAXED for the BridgeLink server hop " +
      "(self-signed certificates are accepted). Set BRIDGELINK_CA_CERT to pin a CA and " +
      "enable full verification. All other outbound TLS verifies normally."
  );
  return new Agent({ connect: { rejectUnauthorized: false } });
}

function getDispatcher(): Promise<Dispatcher> {
  if (!dispatcherPromise) {
    const p = buildDispatcher();
    // Don't cache a rejected promise: if creation fails (e.g. an unreadable
    // BRIDGELINK_CA_CERT), clear the cache so a later request can retry after a
    // runtime fix instead of being permanently wedged until process restart.
    p.catch(() => {
      if (dispatcherPromise === p) dispatcherPromise = undefined;
    });
    dispatcherPromise = p;
  }
  return dispatcherPromise;
}

// `dispatcher` is an undici extension to RequestInit not present in the DOM lib types.
type BlRequestInit = RequestInit & { dispatcher?: Dispatcher };

/**
 * Fetch a BridgeLink upstream URL with scoped TLS for this hop.
 * Use this for every server-to-server call to a resolved BridgeLink server.
 */
export async function fetchBridgeLink(url: string | URL, init?: RequestInit): Promise<Response> {
  const dispatcher = await getDispatcher();
  const merged: BlRequestInit = { ...(init ?? {}), dispatcher };
  return fetch(url, merged);
}
