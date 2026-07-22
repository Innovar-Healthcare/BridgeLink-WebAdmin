# Testing

Plugins are expected to ship with tests, and the suite must pass before a plugin
can be submitted or built (`npm run test:unit` is part of the `npm run ci` gate —
see [LOCAL-SETUP.md](./LOCAL-SETUP.md)). This guide covers the tooling, what to
test, and the patterns to follow.

---

## Tooling

The project uses **Vitest** with **React Testing Library**. `@testing-library/react`'s
`render` and `screen` are available for components, and jest-dom matchers
(`toBeInTheDocument()`, etc.) are registered in the test setup. Run the suite
from the checkout root:

```bash
npm run test:unit
```

This runs the unit suite under `__tests__/unit/` (the convention below), so place
your plugin's tests there.

---

## What to test

| You added…                                    | Test that…                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------ |
| A parser/serializer (e.g. a transformer step) | XML round-trips: `parse(serialize(x))` returns an equivalent object                  |
| Generated-script emission                     | `emitScript()` produces the expected JavaScript for representative inputs            |
| Validation logic                              | Valid input returns `null`/no error; each invalid case returns its message           |
| A settings tab / component                    | It renders, shows loading/error states, and key interactions call the right handlers |
| An API wrapper                                | The correct endpoint/method/body is called (with `fetch` mocked)                     |
| `fromRecord` / `toRecord`                     | Round-trip a property record back to itself                                          |

Aim to cover the logic a reviewer can't eyeball: round-trips, validation
branches, and save flows. A bug fix should come with a regression test that would
have caught it.

---

## Patterns

### Mock the plugin registry

Components that read the plugin registry should mock it so the test doesn't depend
on global registration:

```typescript
import { vi } from "vitest";

const mockRegistry = vi.hoisted(() => ({
  permissionsProvider: null,
  settingsTabs: [],
  ssoLoginSection: null,
  postLoginVerify: null,
}));

vi.mock("@/lib/plugin-registry", () => ({ pluginRegistry: mockRegistry }));
```

### Never make real network calls

Mock `global.fetch` (or the API module) — unit tests must not reach a real
server:

```typescript
import { vi, beforeEach, it, expect } from "vitest";

beforeEach(() => {
  global.fetch = vi.fn(
    async () => new Response(JSON.stringify({ "starter.enable": "true" }), { status: 200 })
  );
});
```

### Round-trip example

```typescript
import { describe, it, expect } from "vitest";
import { fromRecord, toRecord } from "@/plugins/my-plugin/api-my-plugin";

describe("my-plugin settings", () => {
  it("round-trips a property record", () => {
    const record = { "myplugin.enable": "true" };
    expect(toRecord(fromRecord(record))).toEqual(record);
  });
});
```

Import plugin code via the `@/plugins/<name>/…` alias, the same way the
application does.

---

## File conventions

- Unit tests: `__tests__/unit/<plugin-name>-<feature>.test.ts` (or `.test.tsx`
  for components).
- Name tests for the behavior, not the implementation —
  `"returns an error when the source variable is empty"`, not `"tests validate"`.

---

## Coverage expectations for submission

A submitted plugin should have unit tests covering:

- Every parse/serialize round-trip and script-emission path it adds
- All validation branches (each error message reachable by a test)
- The settings load → edit → save flow, including the error state
- Any non-trivial pure logic (converters, parsers, helpers)

Integration tests against a live BridgeLink server are encouraged for full-stack
plugins but are not a substitute for unit coverage. Everything must pass under
`npm run ci`. See the [pre-submission checklist](./CHECKLIST.md).
