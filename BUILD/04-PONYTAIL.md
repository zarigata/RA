# BUILD/04 — PONYTAIL

**Phase:** 04
**Objective:** Implement the **ponytail** plugin — a prompt enhancer that upgrades user prompts before they reach the model, improving code quality and reducing retries.
**Gate:** ponytail loads; enhanced prompts produce better-structured output; enhancement is visible in logs.

---

## 1. What ponytail does

Ponytail is a **prompt enhancement** plugin. Before a user prompt goes to the LLM, ponytail:

1. **Detects intent** — is this a code task, a question, a review, a plan, a debug?
2. **Enriches** — appends task-appropriate structure: context, constraints, acceptance criteria, output format.
3. **Fixes ambiguity** — flags missing info (language, framework, target, constraints) and asks the user to fill gaps.
4. **Adds quality rails** — "verify with tests", "match existing style", "report what changed".

Result: the model gets a better prompt → better code → fewer retries → fewer tokens.

---

## 2. Implementation

### 2.1 File

`.opencode/plugins/ponytail.ts`

### 2.2 Hook

Use the `tui.prompt.append` hook (fires when the user submits a prompt) and `message.part.updated` for post-hoc enhancement.

### 2.3 Code skeleton

```ts
import type { Plugin } from "@opencode-ai/plugin"

type Intent = "code" | "plan" | "review" | "debug" | "question" | "docs" | "unknown"

function detectIntent(text: string): Intent {
  if (/\b(implement|write|create|build|add|fix|refactor|change)\b/i.test(text)) return "code"
  if (/\b(plan|design|architecture|approach|strategy)\b/i.test(text)) return "plan"
  if (/\b(review|audit|critique|check)\b/i.test(text)) return "review"
  if (/\b(debug|error|crash|fails?|broken|trace)\b/i.test(text)) return "debug"
  if (/\b(doc|readme|comment|explain)\b/i.test(text)) return "docs"
  if (/\b(what|why|how|is|are|does)\b/i.test(text)) return "question"
  return "unknown"
}

const ENHANCEMENTS: Record<Intent, string> = {
  code: `
Enhancement (ponytail):
- State the target language/framework if known.
- List acceptance criteria the result must meet.
- Specify constraints: performance, security, compatibility.
- After implementing, verify with tests or a syntax check.
- Match existing code style. Do not add comments unless the codebase uses them.
- Report what changed and how it was verified.`,
  plan: `
Enhancement (ponytail):
- Break into ordered steps, each with a verification.
- Identify risks, edge cases, and dependencies.
- Estimate effort and cost.`,
  review: `
Enhancement (ponytail):
- Review for security, performance, correctness, maintainability.
- For each finding: location, problem, evidence, suggested fix, severity.
- Give a verdict: safe to ship or not.`,
  debug: `
Enhancement (ponytail):
- Find root cause, not symptoms.
- Reproduce first, then hypothesize, then verify.
- Report evidence for each hypothesis.`,
  docs: `
Enhancement (ponytail):
- Clear, concise, accurate to the code.
- Match the project's doc style.
- Include code examples where helpful.`,
  question: `
Enhancement (ponytail):
- Answer directly first, then explain.
- If uncertain, say so and give confidence.`,
  unknown: `
Enhancement (ponytail):
- If this is a coding task, state the language/framework and acceptance criteria.
- If a plan, break into steps with verification.
- If a review, use the review format.`,
}

export const PonytailPlugin: Plugin = async ({ client }) => {
  return {
    "tui.prompt.append": async (input, output) => {
      const text = input.prompt ?? ""
      if (!text.trim()) return
      const intent = detectIntent(text)
      output.prompt = text + ENHANCEMENTS[intent]
      await client.app.log({
        body: {
          service: "ponytail",
          level: "debug",
          message: `enhanced prompt (intent=${intent})`,
        },
      })
    },
  }
}
```

### 2.4 Ambiguity detection (optional, v1.1)

If the prompt is a code task but lacks language/framework, append a question instead of an enhancement:

```ts
if (intent === "code" && !/\b(python|js|ts|rust|go|java|c\+\+|ruby|php|react|node|django|flask)\b/i.test(text)) {
  output.prompt = text + "\n\n[ponytail] Which language/framework? What are the acceptance criteria?"
}
```

---

## 3. Configuration

Add to `opencode.json`:

```jsonc
{
  "ponytail": {
    "enabled": true,
    "detectIntent": true,
    "askWhenAmbiguous": true,
    "logLevel": "debug"
  }
}
```

The plugin reads `ponytail.*` from config. Unknown config keys are ignored by opencode, so this is safe.

---

## 4. Definition of Done (gate)

```bash
cd anubis
bun run build
bun run cli
# in TUI:
#   "implement a fibonacci function" → response should include acceptance criteria + verification
#   "review the last change" → response should use the review format
#   "what is a monad" → direct answer first
# check logs: client.app.log shows "enhanced prompt (intent=...)"
```

**Gate PASSED** when:
- [ ] Plugin loads without error
- [ ] Code prompts produce structured, verified output
- [ ] Review prompts use the review format
- [ ] Ambiguous code prompts ask for language/criteria
- [ ] Logs show intent detection

**Gate FAILED** → BUILD/11-BUGFIX.md.

---

## 5. Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| plugin not loaded | wrong path | must be `.opencode/plugins/ponytail.ts` |
| enhancement not applied | hook name wrong | use `tui.prompt.append` exactly |
| double enhancement | both append + part hooks | only use one hook for injection |
| config ignored | wrong key | read `ponytail.*`; opencode passes unknown keys through |
| log spam | logLevel debug | set `logLevel: "info"` |

---

## 6. Handoff

Gate passed → **BUILD/05-MOA.md**.

Log in `BUILD/LOG.md`:
```
## Phase 04 — PASSED
- Date: <date>
- Ponytail: enabled, intent detection on
```
