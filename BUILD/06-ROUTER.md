# BUILD/06 — ROUTER

**Phase:** 06
**Objective:** Implement the role→model assignment system. **No model is ever locked.** The user assigns models to roles via config, the `/models` picker, or the `--model` flag. The router plugin surfaces and validates these assignments.
**Gate:** assignment works via all three mechanisms; router reports which model each role uses; no role has a hardcoded model.

---

## 1. Assignment mechanisms (priority order)

| Priority | Mechanism | Scope | How |
|---|---|---|---|
| 1 | `--model` CLI flag | session-wide | `anubis --model anthropic/claude-sonnet-4-5` |
| 2 | `agent.<role>.model` | per-role, persistent | `opencode.json` |
| 3 | `/models` picker | per-session, runtime | TUI picker |

opencode resolves in this order natively. The router plugin adds:
- **Validation** — warn if a role's model is unreachable or lacks tool-calling.
- **Visibility** — `/roles` command shows role → model mapping.
- **Templates** — `opencode.example.json` with commented suggestions.

---

## 2. Implementation

### 2.1 File

`.opencode/plugins/router.ts`

### 2.2 Code skeleton

```ts
import type { Plugin } from "@opencode-ai/plugin"

export const RouterPlugin: Plugin = async ({ client }) => {
  return {
    "tui.command.execute": async (input, output) => {
      if (input.command.startsWith("/roles")) {
        output.handled = true
        await showRoles(client)
      }
    },
    "session.created": async () => {
      await logAssignments(client)
    },
  }
}

async function showRoles(client: any) {
  // Read agent config from opencode.json (client.config or direct file read).
  // For each role: name, assigned model (or "unassigned → uses default").
  // Print a table.
}

async function logAssignments(client: any) {
  // Log role → model mapping at session start.
  // Warn if a role is unassigned (it will use the global default).
}
```

### 2.3 `/roles` output format

```
ROLE        MODEL                          SOURCE
anubis      anthropic/claude-sonnet-4-5    config
planner     google/gemini-2.5-pro          config
coder       anthropic/claude-sonnet-4-5    config
reviewer    ollama/gemma:latest            config
critic      (unassigned) → default         default
researcher  (unassigned) → default         default
scribe      ollama/minimax-m3:cloud        config
swift       ollama/minimax-m3:cloud        config
```

---

## 3. Template config (shipped, never enforced)

Create `opencode.example.json` in the repo root:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-sonnet-4-5",
  "small_model": "ollama/gemma:latest",
  "agent": {
    // USER CHOICE — edit these to your team. Nothing is locked.
    "planner":  { "model": "google/gemini-2.5-pro" },
    "coder":    { "model": "anthropic/claude-sonnet-4-5" },
    "reviewer": { "model": "ollama/gemma:latest" },
    "critic":   { "model": "openai/o3-mini" },
    "researcher": { "model": "openrouter/meta-llama/llama-4-maverick" },
    "scribe":   { "model": "ollama/minimax-m3:cloud" },
    "swift":    { "model": "ollama/minimax-m3:cloud" }
  },
  "moa": { "roles": ["planner", "coder", "reviewer", "critic"] },
  "pipeline": { "stages": ["planner", "coder", "reviewer", "critic", "coder", "scribe"] }
}
```

Users copy this to `opencode.json` and edit. The fork never ships a `opencode.json` with models set.

---

## 4. Cost-aware defaults (documented, not enforced)

The template comments suggest a cost strategy:

```
// Cost strategy (suggested, your choice):
//   Local/LAN (free): reviewer, swift, scribe, small_model
//   Cloud (paid): coder, planner, critic
//   This reserves cloud tokens for heavy work.
```

---

## 5. Definition of Done (gate)

```bash
cd anubis
bun run build
bun run cli
# in TUI:
#   /roles  → shows role→model table
#   /models → picker works, selection applies
#   /moa "task" → logs show each role's model
# CLI:
#   anubis --model ollama/gemma:latest  → session uses gemma
```

**Gate PASSED** when:
- [ ] `/roles` shows the mapping
- [ ] `/models` picker works
- [ ] `--model` flag overrides
- [ ] `opencode.example.json` ships with commented suggestions, no enforced models
- [ ] No role file contains a `model:` field
- [ ] Router logs assignments at session start

**Gate FAILED** → BUILD/11-BUGFIX.md.

---

## 6. Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| role uses wrong model | stale config | check `agent.<role>.model`; check `--model` flag |
| `/roles` empty | config not read | read `opencode.json` from project + global |
| model unreachable | bad provider/key | `/connect` the provider; check key |
| model lacks tool-calling | wrong model for role | router warns; user picks a tool-calling model |
| template enforced | fork ships opencode.json | remove; ship only `opencode.example.json` |

---

## 7. Handoff

Gate passed → **BUILD/07-LAN.md**.

Log in `BUILD/LOG.md`:
```
## Phase 06 — PASSED
- Date: <date>
- /roles: works
- Template: opencode.example.json shipped
- Locked models: none
```
