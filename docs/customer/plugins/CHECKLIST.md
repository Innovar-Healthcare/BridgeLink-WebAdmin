# Pre-Submission Checklist

Run through this before submitting a plugin to Innovar (or before building a
private, in-house plugin). It consolidates the build, quality, security, and
testing gates covered elsewhere in this SDK. Everything here is a prerequisite
for review and inclusion by Innovar.

---

## Build & quality gates

- [ ] `npm run ci` passes with **zero errors and zero warnings** (TypeScript,
      ESLint, table/border linters, Prettier, unit tests)
- [ ] `npx tsc --noEmit` is clean
- [ ] No `console.log` or `any` types in shipped code
- [ ] No "Mirth" in comments or user-visible strings (except Java FQN literals and
      server-defined metadata keys)

## Plugin structure

- [ ] `plugins/<name>/index.ts` default-exports a `definePlugin({...})` manifest
- [ ] `serverPluginName` on the manifest matches the server plugin `<name>`
      exactly
- [ ] All base-app imports use `@/` path aliases; no imports from other plugins
- [ ] `routePages` / `routeHandlers` declared on the manifest for any routes used,
      with a matching dispatcher route file under `app/` (`routeHandlers` use lazy
      `loader: () => import(...)` thunks, never eager imports)
- [ ] The application still builds and runs with your plugin directory removed
      (graceful absence)
- [ ] Dark mode looks correct

## Server half (full-stack plugins)

- [ ] `@PUT`/`@POST` body parameters use only XStream-safe types
      (`Properties`, `String`, or BridgeLink core domain classes) — never a
      plugin-defined DTO as a request body
- [ ] Every endpoint parameter carries `@Param("name")`
- [ ] No HTTP 401 returned from plugin endpoints (auth is the framework's job)
- [ ] Only the documented build profiles for your target BridgeLink versions

## Security (see [SECURITY.md](./SECURITY.md))

- [ ] No message content, credentials, or config leaves the BridgeLink trust
      boundary; no undisclosed outbound calls
- [ ] Secrets never logged, persisted client-side, or echoed back; `SecretInput`
      used for secret fields; server secrets marked `excludeFromAudit`
- [ ] No `dangerouslySetInnerHTML` on untrusted data; no `eval`/dynamic code
- [ ] Authorization enforced server-side, not just hidden in the UI; `permissionKey`
      set on UI surfaces
- [ ] No known-vulnerable or unnecessarily bundled dependencies; source is not
      obfuscated

## Testing (see [TESTING.md](./TESTING.md))

- [ ] Unit tests cover parse/serialize round-trips, validation branches, and the
      settings load → edit → save flow (including the error state)
- [ ] No real network calls in unit tests (`fetch` or the API module is mocked)
- [ ] Bug fixes include a regression test

## Compatibility & metadata

- [ ] Works with the currently supported BridgeLink release; you commit to keeping
      it compatible as BridgeLink evolves
- [ ] Plugin display name, slug, and a short description are defined and consistent
      between the Web Administrator half and the server `plugin.xml`

---

When every box is checked, engage your Innovar contact to begin review.
