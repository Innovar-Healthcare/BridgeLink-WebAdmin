# Security Requirements

Plugins run inside the BridgeLink Web Administrator — an authenticated admin
interface that operates on integration channels and message data — and often add
a server-side extension as well. Every plugin submitted to Innovar goes through a
**security review**, and these are the requirements that review checks against.
Build to them from the start; they're also good practice for a private, in-house
plugin.

---

## Data boundaries (most important)

BridgeLink processes healthcare integration traffic, which routinely includes
PHI. The cardinal rule:

> **Message data, credentials, and configuration must not leave the BridgeLink
> trust boundary.** No plugin may exfiltrate channel content, message payloads,
> or server configuration to an external service.

- **No telemetry on message content.** Do not send message bodies, attachments,
  or derived data to analytics, logging, or third-party endpoints.
- **External calls must be explicit and configured.** If your plugin's purpose
  legitimately requires calling an outside service, that endpoint must be
  operator-configured (not hardcoded to a vendor URL), disabled by default where
  feasible, and documented. Never make undisclosed outbound connections.
- **Keep server calls on the trusted path.** Use the API helpers from
  `@/lib/api-client` (the typed `request()` wrapper, or higher-level helpers like
  `getPluginProperties` / `setPluginProperties`), which route through the
  application's authenticated proxy to the connected BridgeLink server. Don't open
  your own unauthenticated channels to the server.

---

## Credentials and secrets

- **Never log secrets.** No passwords, tokens, keys, or connection strings in
  `console`, server logs, or error messages. (`console.log` is not allowed in
  shipped code at all.)
- **Mask secret inputs.** Use the shared `SecretInput` component
  (`@/components/ui/secret-input`) for passwords, API keys, keystores, and
  secrets. It uses `type="text"` with `autoComplete="off"` so browser password
  managers don't capture server credentials.
- **Don't persist secrets client-side.** No secrets in `localStorage`,
  `sessionStorage`, URLs, or query strings.
- **Don't echo secrets back.** A settings GET should not return stored secrets in
  cleartext; expose a boolean like `hasCredential` instead of the value.
- **Server side:** mark secret parameters with
  `@Param(value = "password", excludeFromAudit = true)` so they stay out of the
  audit log.

---

## Cross-site scripting and injection

- **Trust React's escaping.** Render untrusted values as text/props; React
  escapes them. Avoid `dangerouslySetInnerHTML` — if you genuinely need it,
  sanitize the input first and document why.
- **No dynamic code execution.** No `eval`, `new Function`, or executing strings
  fetched at runtime.
- **Treat message content as untrusted.** Message payloads, channel names, and
  user-entered configuration may contain hostile content — never interpolate them
  into HTML, scripts, or shell/SQL on the server without escaping.

---

## Authentication and authorization

- **Don't bypass auth.** The application and the proxy carry the operator's
  session; rely on it. Don't invent a side channel that skips it.
- **Respect RBAC.** Gate your settings tab, page, and actions with a
  `permissionKey` so they hide when the user lacks permission. If your plugin
  enforces its own permissions, do it through the permissions provider, not ad
  hoc checks.
- **Server-side authorization is the real gate.** UI gating is convenience;
  enforce permissions on the server endpoint with the appropriate
  `@MirthOperation` permission. Never rely on the UI hiding a control as your only
  protection.
- **Don't use HTTP 401 from a plugin endpoint** — authentication is handled by
  the BridgeLink framework, not individual plugins.

---

## Dependencies and supply chain

- **Don't bundle what BridgeLink already provides** (Apache Commons, the server's
  internal APIs, etc.) — version conflicts cause subtle, hard-to-trace failures.
- **Vet third-party dependencies.** Use maintained libraries at current versions;
  no dependencies with known vulnerabilities. Keep the dependency surface small.
- **No obfuscated or minified-only source.** Submitted source must be readable and
  reviewable.

---

## What the review checks

A submission is reviewed for, at minimum:

- No data exfiltration; message content and config stay in the trust boundary
- No undisclosed outbound network calls; external endpoints are operator-configured
- Secrets never logged, persisted client-side, or echoed back
- No `dangerouslySetInnerHTML` on untrusted data; no dynamic code execution
- Authorization enforced server-side, not just hidden in the UI
- No known-vulnerable or unnecessarily bundled dependencies
- Readable source; no obfuscation

Meeting these is a prerequisite for inclusion in the standard distribution and for
in-house build authorization. See the [pre-submission checklist](./CHECKLIST.md).
