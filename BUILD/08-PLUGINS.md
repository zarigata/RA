# BUILD/08 — PLUGINS

**Phase:** 08
**Objective:** Bundle the full plugin suite. Tier-1 plugins are embedded and always on. Tier-2 plugins are bundled and installable. All must load without conflicts.
**Gate:** all tier-1 + tier-2 plugins load; no hook conflicts; tests pass.

---

## 1. Tier-1 plugins (embedded, always on)

| Plugin | File | Purpose | Status |
|---|---|---|---|
| caveman | `.opencode/skills/caveman*/` + `.opencode/plugins/caveman.ts` | token compression | BUILD/03 |
| ponytail | `.opencode/plugins/ponytail.ts` | prompt enhancement | BUILD/04 |
| moa | `.opencode/plugins/moa.ts` | parallel orchestration | BUILD/05 |
| pipeline | `.opencode/plugins/moa.ts` (same file) | sequential orchestration | BUILD/05 |
| router | `.opencode/plugins/router.ts` | role→model assignment | BUILD/06 |
| lan | `.opencode/plugins/lan.ts` | LAN discovery | BUILD/07 |
| cost-tracker | `.opencode/plugins/cost-tracker.ts` | per-role token/cost | this phase |
| vibeguard | `.opencode/plugins/vibeguard.ts` | secret/PII redaction | this phase |
| dcp | `.opencode/plugins/dcp.ts` | dynamic context pruning | this phase |
| notify | `.opencode/plugins/notify.ts` | OS notifications | this phase |
| wakatime | `.opencode/plugins/wakatime.ts` | usage tracking | this phase |

---

## 2. Tier-1 implementations

### 2.1 cost-tracker.ts

Tracks tokens and estimated cost per role. Uses `message.part.updated` and `session.idle` hooks.

```ts
import type { Plugin } from "@opencode-ai/plugin"

const PRICES: Record<string, { in: number; out: number }> = {
  "anthropic/claude-sonnet-4-5": { in: 3, out: 15 },   // $/M tokens
  "google/gemini-2.5-pro":       { in: 1.25, out: 10 },
  "openai/o3-mini":              { in: 1.1, out: 4.4 },
  "ollama/*":                     { in: 0, out: 0 },     // local = free
}

export const CostTrackerPlugin: Plugin = async ({ client }) => {
  const usage: Record<string, { in: number; out: number }> = {}
  return {
    "message.part.updated": async (input) => {
      const part = input.part
      if (part?.type === "text" && part.usage) {
        const model = part.model ?? "unknown"
        usage[model] = usage[model] ?? { in: 0, out: 0 }
        usage[model].in += part.usage.inputTokens ?? 0
        usage[model].out += part.usage.outputTokens ?? 0
      }
    },
    "session.idle": async () => {
      // print cost table
      const lines = Object.entries(usage).map(([m, u]) => {
        const p = PRICES[m] ?? PRICES["ollama/*"]
        const cost = (u.in / 1e6) * p.in + (u.out / 1e6) * p.out
        return `${m}: ${u.in} in / ${u.out} out — $${cost.toFixed(4)}`
      })
      await client.app.log({ body: { service: "cost-tracker", level: "info", message: lines.join("\n") } })
    },
  }
}
```

**Note:** exact usage fields depend on the SDK version. Builder must verify against `@opencode-ai/sdk` types. If usage is not exposed per-part, fall back to estimating from text length.

### 2.2 vibeguard.ts

Redacts secrets/PII before LLM calls; restores after. Uses `tool.execute.before` and `tool.execute.after`.

```ts
import type { Plugin } from "@opencode-ai/plugin"

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9]{20,}/g,          // OpenAI-style
  /sk-ant-[A-Za-z0-9_-]{20,}/g,   // Anthropic-style
  /AIza[A-Za-z0-9_-]{20,}/g,      // Google-style
  /ghp_[A-Za-z0-9]{30,}/g,        // GitHub PAT
  /AKIA[A-Z0-9]{16}/g,            // AWS access key
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
]

export const VibeguardPlugin: Plugin = async () => {
  const stash = new Map<string, string>()
  let counter = 0
  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool === "read" || input.tool === "bash") {
        const text = JSON.stringify(output.args)
        const redacted = text.replace(SECRET_PATTERNS, (m) => {
          const key = `__VIBEGUARD_${counter++}__`
          stash.set(key, m)
          return key
        })
        if (redacted !== text) {
          output.args = JSON.parse(redacted)
        }
      }
    },
    "tool.execute.after": async (input, output) => {
      // restore placeholders in output
      let text = JSON.stringify(output)
      for (const [k, v] of stash) {
        text = text.replaceAll(k, v)
      }
      // write back
    },
  }
}
```

**Security note:** this is best-effort redaction. It does not replace proper secret hygiene. Never commit secrets.

### 2.3 dcp.ts (dynamic context pruning)

Prunes obsolete tool outputs to save context. Uses `message.part.updated` to drop large tool outputs that were superseded.

```ts
import type { Plugin } from "@opencode-ai/plugin"

export const DcpPlugin: Plugin = async ({ client }) => {
  return {
    "message.part.updated": async (input) => {
      const part = input.part
      if (part?.type === "tool" && part.state?.status === "completed") {
        const text = part.state.output ?? ""
        if (text.length > 20000) {
          // truncate huge tool outputs; keep first 2000 + last 1000 chars
          part.state.output = text.slice(0, 2000) + "\n...[truncated by dcp]...\n" + text.slice(-1000)
        }
      }
    },
  }
}
```

**Note:** mutating `part.state.output` may or may not be supported depending on SDK version. If not, log a warning and skip. The upstream `opencode-dynamic-context-pruning` plugin (Tarquinen) is a reference implementation — vendor or adapt it.

### 2.4 notify.ts

OS notifications on session events.

```ts
import type { Plugin } from "@opencode-ai/plugin"

export const NotifyPlugin: Plugin = async ({ $ }) => {
  return {
    event: async ({ event }) => {
      if (event.type === "session.idle") {
        await $`osascript -e 'display notification "Session complete" with title "Anubis"'`
      }
      if (event.type === "session.error") {
        await $`osascript -e 'display notification "Session error" with title "Anubis"'`
      }
    },
  }
}
```

**Note:** `osascript` is macOS. For Linux use `notify-send`; for Windows use PowerShell toast. Detect OS at runtime.

### 2.5 wakatime.ts

Track usage with WakaTime. Requires a WakaTime API key (opt-in).

```ts
import type { Plugin } from "@opencode-ai/plugin"

export const WakatimePlugin: Plugin = async ({ client }) => {
  const key = process.env.WAKATIME_API_KEY
  if (!key) return {} // disabled unless key present
  return {
    "session.idle": async () => {
      // POST heartbeat to wakatime API
    },
  }
}
```

---

## 3. Tier-2 plugins (bundled, installable)

All are existing opencode ecosystem plugins. Bundle them as npm deps in `.opencode/package.json` and document usage. **Do not rewrite them** — reuse upstream.

| Plugin | Source | Purpose |
|---|---|---|
| background-agents | github.com/kdcokenny/opencode-background-agents | async delegation |
| pty | github.com/shekohex/opencode-pty | background processes in PTY |
| worktree | github.com/kdcokenny/opencode-worktree | git worktree isolation |
| websearch-cited | github.com/ghoulr/opencode-websearch-cited | cited web search |
| supermemory | github.com/supermemoryai/opencode-supermemory | persistent memory |
| conductor | github.com/derekbar90/opencode-conductor | spec→plan→implement |
| subtask2 | github.com/spoons-and-mirrors/subtask2 | command orchestration |
| morph-fast-apply | github.com/JRedeker/opencode-morph-fast-apply | fast code editing |
| firecrawl | github.com/firecrawl/opencode-firecrawl | web scraping |
| tavily | github.com/tavily-ai/opencode-tavily | web search/research |
| scheduler | github.com/different-ai/opencode-scheduler | cron jobs |
| helicone-session | github.com/H2Shami/opencode-helicone-session | LLM observability |
| sentry-monitor | github.com/stolinski/opencode-sentry-monitor | agent tracing |
| type-inject | github.com/nick-vi/opencode-type-inject | TS type injection |
| md-table-formatter | github.com/franlol/opencode-md-table-formatter | table cleanup |
| shell-strategy | github.com/JRedeker/opencode-shell-strategy | non-interactive shell |
| goal-plugin | github.com/willytop8/OpenCode-goal-plugin | session goals |
| daytona | github.com/daytona/integrations | sandboxed sessions |
| devcontainers | github.com/athal7/opencode-devcontainers | devcontainer isolation |
| gemini-auth | github.com/jenslys/opencode-gemini-auth | Gemini subscription auth |
| codex-auth | github.com/numman-ali/opencode-openai-codex-auth | ChatGPT Plus auth |
| antigravity-auth | github.com/NoeFabris/opencode-antigravity-auth | free Antigravity models |
| oh-my-opencode | github.com/code-yeongyu/oh-my-opencode | background agents + tools |
| opencode-agents | github.com/darrenhinde/opencode-agents | agent configs |
| Agentic | github.com/Cluster444/agentic | modular agents |
| workspace | github.com/kdcokenny/opencode-workspace | 16-component harness |
| ocx | github.com/kdcokenny/ocx | extension manager |

### 3.1 Bundle method

Add to `.opencode/package.json`:

```json
{
  "dependencies": {
    "opencode-background-agents": "*",
    "opencode-pty": "*",
    "opencode-worktree": "*",
    "opencode-websearch-cited": "*",
    "opencode-supermemory": "*",
    "opencode-conductor": "*",
    "@openspoon/subtask2": "*",
    "opencode-morph-fast-apply": "*",
    "opencode-firecrawl": "*",
    "opencode-tavily": "*",
    "opencode-scheduler": "*",
    "opencode-helicone-session": "*",
    "opencode-sentry-monitor": "*",
    "opencode-type-inject": "*",
    "@franlol/opencode-md-table-formatter": "*",
    "opencode-shell-strategy": "*",
    "opencode-goal-plugin": "*",
    "opencode-daytona": "*",
    "opencode-devcontainers": "*",
    "opencode-gemini-auth": "*",
    "opencode-openai-codex-auth": "*",
    "opencode-antigravity-auth": "*",
    "oh-my-opencode": "*",
    "opencode-agents": "*",
    "agentic": "*",
    "opencode-workspace": "*",
    "ocx": "*"
  }
}
```

**Note:** exact package names must be verified against each repo's npm publish name. Some may not be on npm (e.g. `ocx` is a separate CLI). The builder must verify each and adjust. Plugins that are not npm-published are documented as manual installs.

### 3.2 Load-order and conflict matrix

opencode load order: global config → project config → global plugins → project plugins. Duplicate npm packages load once.

| Conflict risk | Resolution |
|---|---|
| two plugins hook `tui.prompt.append` (ponytail + goal) | both run; order = load order. Test. |
| two plugins hook `session.idle` (cost-tracker + notify + wakatime) | all run; independent. |
| two plugins define same custom tool name | last-loaded wins; rename one. |
| dcp vs upstream dcp | use one; prefer upstream if it works. |
| background-agents vs oh-my-opencode | both provide background agents; test for conflict, keep one if clash. |

---

## 4. Definition of Done (gate)

```bash
cd anubis
bun install
bun run build
bun run cli
# in TUI:
#   /roles, /moa, /pipeline, /lan-scan, /cost  → all work
#   send a prompt with a fake secret → output shows it redacted (vibeguard)
#   complete a session → notification fires (notify)
#   check logs → cost-tracker prints table
```

**Gate PASSED** when:
- [ ] All tier-1 plugins load
- [ ] All tier-2 plugins install and load (or are documented as manual)
- [ ] No hook conflicts break functionality
- [ ] `/cost` shows per-role usage
- [ ] vibeguard redacts secrets
- [ ] notify fires on session end
- [ ] dcp truncates oversized tool outputs

**Gate FAILED** → BUILD/11-BUGFIX.md.

---

## 5. Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| plugin fails to load | SDK API mismatch | verify against installed `@opencode-ai/plugin` types |
| npm package not found | wrong name | check repo's npm publish name; adjust |
| hook conflict | two plugins same hook | test; reorder or disable one |
| cost table empty | usage not exposed | fall back to length estimation |
| vibeguard breaks output | restore logic bug | test round-trip; fix restore |
| too many plugins slow boot | heavy deps | lazy-load; document |

---

## 6. Handoff

Gate passed → **BUILD/09-INSTALLER.md**.

Log in `BUILD/LOG.md`:
```
## Phase 08 — PASSED
- Date: <date>
- Tier-1 loaded: <n>
- Tier-2 loaded: <n>
- Conflicts resolved: <list>
```
