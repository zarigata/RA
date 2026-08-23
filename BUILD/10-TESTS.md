# BUILD/10 — TESTS

**Phase:** 10
**Objective:** Deep test matrix. Unit tests for plugins, end-to-end tests for MOA/pipeline/LAN/router, regression tests. All must be green before release.
**Gate:** all suites pass; coverage report generated; no regressions.

---

## 1. Test stack

| Layer | Tool | Location |
|---|---|---|
| Unit (plugins) | bun test | `tests/unit/` |
| E2E (TUI flows) | bun test + spawn CLI | `tests/e2e/` |
| MOA behavior | bun test + mock SDK | `tests/moa/` |
| LAN discovery | bun test + mock HTTP | `tests/lan/` |
| Router | bun test + config fixtures | `tests/router/` |
| Regression | full suite re-run | `tests/regression/` |

opencode uses `bun test`. Verify: `bun test --help`.

---

## 2. Unit tests

### 2.1 ponytail (`tests/unit/ponytail.test.ts`)

```ts
import { describe, expect, test } from "bun:test"
import { detectIntent } from "../../.opencode/plugins/ponytail"

describe("ponytail intent detection", () => {
  test("detects code intent", () => {
    expect(detectIntent("implement a fibonacci function")).toBe("code")
  })
  test("detects plan intent", () => {
    expect(detectIntent("plan the architecture")).toBe("plan")
  })
  test("detects review intent", () => {
    expect(detectIntent("review the last change")).toBe("review")
  })
  test("detects debug intent", () => {
    expect(detectIntent("debug the crash")).toBe("debug")
  })
  test("detects question intent", () => {
    expect(detectIntent("what is a monad")).toBe("question")
  })
  test("detects docs intent", () => {
    expect(detectIntent("document the API")).toBe("docs")
  })
  test("unknown intent fallback", () => {
    expect(detectIntent("hello")).toBe("unknown")
  })
})
```

**Note:** `detectIntent` must be exported from the plugin for testability. Refactor the plugin to export pure functions.

### 2.2 vibeguard (`tests/unit/vibeguard.test.ts`)

```ts
import { describe, expect, test } from "bun:test"
import { redact, restore } from "../../.opencode/plugins/vibeguard"

describe("vibeguard", () => {
  test("redacts OpenAI key", () => {
    const { text, stash } = redact("key=sk-abcdefghijklmnopqrstuvwxyz123456")
    expect(text).not.toContain("sk-")
    expect(restore(text, stash)).toContain("sk-")
  })
  test("redacts Anthropic key", () => {
    const { text, stash } = redact("key=sk-ant-api03-abcdefghijklmnopqrstuvwxyz")
    expect(text).not.toContain("sk-ant-")
    expect(restore(text, stash)).toContain("sk-ant-")
  })
  test("round-trip preserves content", () => {
    const input = "token=ghp_abcdefghijklmnopqrstuvwxyz1234567890 rest=hello"
    const { text, stash } = redact(input)
    expect(restore(text, stash)).toBe(input)
  })
})
```

### 2.3 dcp (`tests/unit/dcp.test.ts`)

```ts
import { describe, expect, test } from "bun:test"
import { truncate } from "../../.opencode/plugins/dcp"

describe("dcp truncation", () => {
  test("keeps short output", () => {
    expect(truncate("short", 20000)).toBe("short")
  })
  test("truncates long output", () => {
    const long = "x".repeat(50000)
    const out = truncate(long, 20000)
    expect(out.length).toBeLessThan(50000)
    expect(out).toContain("truncated by dcp")
  })
})
```

### 2.4 cost-tracker (`tests/unit/cost.test.ts`)

```ts
import { describe, expect, test } from "bun:test"
import { estimateCost } from "../../.opencode/plugins/cost-tracker"

describe("cost estimation", () => {
  test("local models are free", () => {
    expect(estimateCost("ollama/gemma:latest", 1000, 1000)).toBe(0)
  })
  test("cloud models cost money", () => {
    expect(estimateCost("anthropic/claude-sonnet-4-5", 1_000_000, 0)).toBeGreaterThan(0)
  })
})
```

---

## 3. E2E tests

### 3.1 Boot test (`tests/e2e/boot.test.ts`)

```ts
import { describe, expect, test } from "bun:test"
import { spawn } from "bun"

describe("anubis boot", () => {
  test("--version prints", async () => {
    const proc = spawn(["bun", "run", "cli", "--version"])
    const out = await new Response(proc.stdout).text()
    expect(out).toContain("anubis")
  })
  test("TUI starts and exits", async () => {
    const proc = spawn(["bun", "run", "cli"], { stdin: "pipe" })
    // send 'q' after 2s
    setTimeout(() => proc.stdin?.write("q"), 2000)
    const code = await proc.exited
    expect(code).toBe(0)
  })
})
```

### 3.2 MOA test (`tests/moa/moa.test.ts`)

```ts
import { describe, expect, test } from "bun:test"
import { buildAggregatePrompt } from "../../.opencode/plugins/moa"

describe("moa aggregation", () => {
  test("aggregate prompt includes all roles", () => {
    const results = [
      { role: "planner", output: "plan" },
      { role: "coder", output: "code" },
      { role: "reviewer", output: "review" },
    ]
    const prompt = buildAggregatePrompt("task", results)
    expect(prompt).toContain("planner")
    expect(prompt).toContain("coder")
    expect(prompt).toContain("reviewer")
    expect(prompt).toContain("task")
  })
})
```

### 3.3 Pipeline test (`tests/moa/pipeline.test.ts`)

```ts
import { describe, expect, test } from "bun:test"
import { validateStages } from "../../.opencode/plugins/moa"

describe("pipeline validation", () => {
  test("rejects orchestrator in stages", () => {
    expect(validateStages(["anubis", "coder"])).toBe(false)
  })
  test("accepts valid stages", () => {
    expect(validateStages(["planner", "coder", "reviewer"])).toBe(true)
  })
})
```

---

## 4. LAN tests (`tests/lan/lan.test.ts`)

```ts
import { describe, expect, test } from "bun:test"
import { scanHost } from "../../.opencode/plugins/lan"

describe("lan scan", () => {
  test("returns null for dead host", async () => {
    const result = await scanHost("127.0.0.1", 1) // port 1 closed
    expect(result).toBeNull()
  })
  test("detects models on live host", async () => {
    // requires a local ollama on 11434
    const result = await scanHost("127.0.0.1", 11434)
    if (result) {
      expect(Array.isArray(result)).toBe(true)
    }
  })
})
```

**Note:** the live-host test is conditional — skip if no local server. Use `test.skipIf`.

---

## 5. Router tests (`tests/router/router.test.ts`)

```ts
import { describe, expect, test } from "bun:test"
import { resolveRoleModel } from "../../.opencode/plugins/router"

describe("router resolution", () => {
  test("config model wins over default", () => {
    const config = { agent: { coder: { model: "anthropic/claude-sonnet-4-5" } } }
    expect(resolveRoleModel("coder", config, "default/model")).toBe("anthropic/claude-sonnet-4-5")
  })
  test("default used when unassigned", () => {
    const config = {}
    expect(resolveRoleModel("critic", config, "default/model")).toBe("default/model")
  })
  test("flag overrides config", () => {
    const config = { agent: { coder: { model: "a" } } }
    expect(resolveRoleModel("coder", config, "default", "flag/model")).toBe("flag/model")
  })
})
```

---

## 6. Regression suite

`tests/regression/` re-runs all suites after every phase change:

```bash
bun test tests/unit tests/moa tests/lan tests/router tests/e2e
```

Add a CI workflow `.github/workflows/test.yml`:

```yaml
name: test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun test tests/unit tests/moa tests/lan tests/router
      - run: bun test tests/e2e
```

---

## 7. Definition of Done (gate)

```bash
cd anubis
bun test tests/unit tests/moa tests/lan tests/router
bun test tests/e2e
bun test tests/regression
```

**Gate PASSED** when:
- [ ] All unit tests pass
- [ ] All MOA/pipeline tests pass
- [ ] LAN tests pass (or skip cleanly without a server)
- [ ] Router tests pass
- [ ] E2E boot tests pass
- [ ] Regression suite green
- [ ] CI workflow runs tests on push

**Gate FAILED** → BUILD/11-BUGFIX.md.

---

## 8. Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| test can't import plugin | plugin not exporting pure functions | refactor plugin to export testable functions |
| E2E hangs | TUI waits for input | use timeout + stdin pipe |
| LAN test fails without server | hard dependency | use `test.skipIf` |
| flaky timing | race in async | add retry or longer timeout |
| coverage low | untested paths | add cases; target > 70% |

---

## 9. Handoff

Gate passed → **BUILD/11-BUGFIX.md**.

Log in `BUILD/LOG.md`:
```
## Phase 10 — PASSED
- Date: <date>
- Unit: <n> passed
- E2E: <n> passed
- Coverage: <pct>
```
