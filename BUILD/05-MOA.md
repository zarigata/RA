# BUILD/05 — MOA

**Phase:** 05
**Objective:** Implement the Mixture-of-Agents engine: `/moa` (parallel fan-out) and `/pipeline` (sequential chain). Both use the role agents from BUILD/02 and the user's model assignments from BUILD/06.
**Gate:** `/moa` runs N roles in parallel and aggregates; `/pipeline` runs stages sequentially; both pass end-to-end tests.

---

## 1. Concepts

### 1.1 MOA (parallel)

```
/moa "implement a REST API"
  → anubis reads moa.roles config
  → spawns planner, coder, reviewer, critic IN PARALLEL (task tool)
  → each works on its assigned model
  → anubis aggregates all outputs into one answer
```

### 1.2 Pipeline (sequential)

```
/pipeline "fix the auth bug"
  → anubis reads pipeline.stages config
  → planner → coder → reviewer → critic → coder(fix) → scribe
  → each stage's output feeds the next
  → final stage produces the deliverable
```

---

## 2. Implementation

### 2.1 Files

- `.opencode/plugins/moa.ts` — both `/moa` and `/pipeline` commands
- `.opencode/commands/moa.md` — command help (optional)
- `.opencode/commands/pipeline.md` — command help (optional)

### 2.2 Command registration

opencode supports custom commands via the `tui.command.execute` hook or command files. Use the plugin hook:

```ts
import type { Plugin } from "@opencode-ai/plugin"

export const MoaPlugin: Plugin = async ({ client, $, directory }) => {
  return {
    "tui.command.execute": async (input, output) => {
      const cmd = input.command
      if (cmd.startsWith("/moa")) {
        output.handled = true
        await runMoa(client, cmd.replace("/moa", "").trim())
      }
      if (cmd.startsWith("/pipeline")) {
        output.handled = true
        await runPipeline(client, cmd.replace("/pipeline", "").trim())
      }
    },
  }
}
```

### 2.3 MOA runner (parallel)

```ts
async function runMoa(client: any, task: string) {
  if (!task) {
    await client.app.log({ body: { service: "moa", level: "warn", message: "usage: /moa <task>" } })
    return
  }
  const roles = await getMoaRoles(client) // from config moa.roles
  // Spawn each role as a parallel subagent via the task tool.
  // opencode's task tool runs subagents; parallel = multiple task calls in one turn.
  const results = await Promise.all(
    roles.map((role) => spawnRole(client, role, task))
  )
  // Aggregate
  const aggregatePrompt = buildAggregatePrompt(task, results)
  await client.session.prompt({ body: { text: aggregatePrompt } })
}

async function spawnRole(client: any, role: string, task: string) {
  // Use the task tool with the role agent. The role's assigned model
  // (from agent.<role>.model) is used automatically by opencode.
  return client.session.prompt({
    body: {
      text: `@${role} ${task}`,
      // subagent: true, // if the SDK supports explicit subagent invocation
    },
  })
}
```

**Note on parallelism:** opencode's `task` tool executes subagents. To run them in parallel, issue multiple task-tool calls in a single assistant turn. The exact SDK call depends on the opencode version; the builder must verify against the installed SDK (`@opencode-ai/sdk`). If the SDK does not expose parallel subagent spawn, fall back to sequential spawn (still correct, just slower) and note it in the log.

### 2.4 Pipeline runner (sequential)

```ts
async function runPipeline(client: any, task: string) {
  const stages = await getPipelineStages(client) // config pipeline.stages
  let current = task
  for (const stage of stages) {
    const result = await spawnRole(client, stage, current)
    current = result // feed output into next stage
  }
  // final output is the deliverable
}
```

### 2.5 Aggregator prompt

```ts
function buildAggregatePrompt(task: string, results: Array<{ role: string; output: string }>) {
  const parts = results.map((r) => `## ${r.role}\n${r.output}`).join("\n\n")
  return `Task: ${task}

The following role agents worked on this task in parallel. Aggregate their outputs into one coherent, correct answer.

${parts}

Aggregation rules:
- Resolve conflicts; prefer the most defensible answer.
- Keep the best of each role's contribution.
- Flag anything the roles disagreed on.
- Report which roles ran and which models they used.`
}
```

---

## 3. Configuration

Add to `opencode.json`:

```jsonc
{
  "moa": {
    "roles": ["planner", "coder", "reviewer", "critic"],
    "parallel": true
  },
  "pipeline": {
    "stages": ["planner", "coder", "reviewer", "critic", "coder", "scribe"]
  }
}
```

Users override per-run: `/moa "task" @planner @coder` uses only those roles.

---

## 4. Definition of Done (gate)

```bash
cd anubis
bun run build
bun run cli
# in TUI:
#   /moa "write a hello world in python with tests"
#   /pipeline "fix the bug in the auth module"
#   /moa "summarize this repo" @planner @scribe
```

**Gate PASSED** when:
- [ ] `/moa` spawns the configured roles
- [ ] Roles run in parallel (or documented fallback to sequential)
- [ ] Aggregator produces one coherent answer
- [ ] `/pipeline` runs stages in order, feeding output forward
- [ ] Per-run role override works (`@planner @coder`)
- [ ] Logs show which roles ran and which models were used

**Gate FAILED** → BUILD/11-BUGFIX.md.

---

## 5. Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| command not recognized | hook name wrong | use `tui.command.execute` |
| roles run sequentially | SDK lacks parallel spawn | document fallback; keep correctness |
| aggregation missing | aggregator prompt not sent | ensure `client.session.prompt` called after results |
| role not found | role name typo | validate against `.opencode/agents/` |
| infinite loop | pipeline stage calls itself | guard: no stage may equal the orchestrator |
| config ignored | wrong key | read `moa.*` / `pipeline.*` |

---

## 6. Handoff

Gate passed → **BUILD/06-ROUTER.md**.

Log in `BUILD/LOG.md`:
```
## Phase 05 — PASSED
- Date: <date>
- /moa: parallel=<yes/no>
- /pipeline: stages=<n>
```
