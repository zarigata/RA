---
name: raker
description: >-
  Relentless task-completion loop for Cursor: a Ralph Wiggum / ponytail hybrid.
  Use when the user types "/raker (task) (completion)" in natural language, or
  says "raker", "ralph loop", "keep going until done", "don't stop until X",
  "loop on this until Y", "autonomous loop", or "persistent task loop". The
  agent never stops until the completion criterion is verifiably met.
---

# Raker

Ralph Wiggum (persistent self-referential loop) + ponytail (lazy-senior, smallest-diff discipline) for Cursor.

User says something like `/raker write integration tests until coverage hits 80%` or
`/raker fix flaky test until npm test passes`. The agent keeps working until the
completion step is *verifiably* met — no premature exits, no faking done.

## Parse

The user message will look like one of these natural-language forms:

- `/raker <task> until <completion>`
- `/raker <task> | <completion>`
- `/raker <task> # completion = <completion>`
- `/raker <task>` (completion inferred as "task is verifiably done"; see Infer)
- `raker <task> until <completion>` (no leading slash)

Split the message (everything after `/raker` or `raker `) at the first of these
separators, in priority order, to get `(task, completion)`:

1. ` until ` (case-insensitive, whole word) — preferred natural-language form
2. ` | ` — explicit pipe
3. ` # ` or ` // ` — comment-style
4. ` when ` or ` so that ` or ` then ` — alternate natural-language forms
5. `;` — semicolon

If nothing matches, treat the whole thing as `task` and infer completion (see Infer).

### Infer completion when no separator

Look at the task for a built-in verifiable signal, in this order:

1. **A test/build/lint command is named** (`pytest`, `npm test`, `cargo test`, `go test`, `tsc --noEmit`, `eslint`, `rake`, `mvn test`, `gradle test`, `npm run build`, etc.) → completion = "that command exits 0".
2. **A coverage or threshold number** (`80%`, `≤50ms`, `>100`, `<1KB`) → completion = "the named metric reaches that threshold".
3. **A target file or symbol** is named → completion = "the target exists, compiles, and the new behavior has a runnable check that passes".
4. **Otherwise** → completion = "the task is verifiably done: the relevant build/test command for this repo exits 0 AND the agent has run it AND seen green". If the repo has no test command, fall back to "agent cannot fake done — must produce a one-file runnable check (see STOPHOOK.md) and see it pass".

### Confirm the parse before starting

Before the first loop iteration, print a one-line confirmation:

```
Raker armed | task: <one-sentence task> | done-when: <one-sentence completion> | cap: infinite (kill: pkill -f RAKER_TICK_<id>)
```

If the parse is genuinely ambiguous (two equally-likely completions, or the task
is one word with no verb), ask exactly ONE clarifying question, then proceed.
Do not stall on the second guess.

## Loop

Cursor has no Claude Code stop hook. The equivalent is the dynamic wake-loop
pattern from `/loop`: a background shell sleeps and emits a sentinel that
re-enters the agent. The prompt payload is fixed at arm time and does not change
between iterations — the agent's *files* change, the prompt doesn't.

Unique sentinel per raker instance: `RAKER_TICK_<PURPOSE>` where `<PURPOSE>` is a
short slug of the task (e.g. `RAKER_TICK_TESTS`, `RAKER_TICK_LINT`).

### Arm sequence (run once, at start)

1. Build the fixed re-entry prompt:

   ```
   <task>

   Loop discipline (raker, iteration N):
   - Read the files and git state. Your previous work persists.
   - Take the smallest step that moves toward the completion criterion.
   - Run the verification command. Observe the result.
   - If verification fails: that's data. Fix root cause, not symptom.
     Grep every caller of the function you touched before editing.
   - If verification passes: STOP. Output the marker line below. Do nothing else.
   - Never fake done. Never summarize around it. Never claim success without
     having run the check this iteration.
   - Marker line (output verbatim, on its own line, only when truly done):
     RAKER_DONE_<PURPOSE>
   ```

2. Start ONE background shell with `notify_on_output` watching `^RAKER_TICK_<PURPOSE>`:

   ```bash
   # raker loop for <purpose>; kill with: pkill -f RAKER_TICK_<PURPOSE>
   i=0
   while true; do
     sleep 30
     i=$((i+1))
     echo "RAKER_TICK_<PURPOSE> {\"i\":$i,\"prompt\":\"<base64-or-escaped-prompt>\"}"
   done
   ```

   - `block_until_ms: 0` so the loop runs in the background.
   - Use the unique sentinel so unrelated output never triggers a wake.
   - 30s is the default tick. If the task is a heavy build (>2 min), bump sleep
     to match; otherwise keep 30s so iterations stay responsive.
   - Track the PID so `/raker stop` (or the user saying "stop raker",
     "cancel raker", "kill the loop") can `pkill -f RAKER_TICK_<PURPOSE>`.

3. Run the prompt **immediately** as iteration 1 — don't wait for the first tick.
   The first tick should arrive only after the initial sleep, so startup never
   double-runs the prompt.

4. After arming, end the turn. State plainly: the task, the done-when, that
   iteration 1 has run, and how to kill it (`pkill -f RAKER_TICK_<PURPOSE>`).

### On each wake

1. Read the latest `RAKER_TICK_<PURPOSE>` line for the iteration number.
2. Execute the fixed re-entry prompt as a fresh turn (this is iteration N).
3. Apply ponytail discipline (see STOPHOOK.md) — smallest-diff, root-cause,
   no-faking-done, leave a runnable check.
4. Run the verification command this iteration. Observe its real output.
5. **Stop condition** (the loop's only exit):
   - If the assistant's last message contains the marker line
     `RAKER_DONE_<PURPOSE>` AND that same message describes the verification
     command having just passed this iteration → loop is complete.
   - Kill the background shell: `pkill -f RAKER_TICK_<PURPOSE>`.
   - Consume the shell's completion notification (don't let it double-wake).
   - Print a final summary: iterations run, files changed, verification output
     that proves done.
6. Otherwise: re-arm is automatic (the shell keeps ticking). Do nothing at the
   end of the turn except report one short line of progress, then end the turn.

### Natural-language stop / cancellation

If the user says any of: `stop raker`, `cancel raker`, `kill the loop`, `halt`,
`abort`, `enough`, `pause raker` — kill the background shell with
`pkill -f RAKER_TICK_<PURPOSE>`, consume the shell completion notification,
and confirm stopped. Do not arm another wake.

## Iteration discipline (per turn)

Each wake is a fresh turn with the same fixed prompt. The agent must:

1. **Read before write.** Always re-read the files and git state at the top of
   the turn — never assume last iteration's in-memory view still holds.
2. **Smallest step that helps.** Ponytail: one rung at a time, prefer the
   smallest diff that makes verification closer to green. No speculative
   refactors, no abstraction the user didn't ask for.
3. **Run the check every iteration.** The verification command must actually be
   executed and its output observed in-turn. Reading code and deciding "this
   looks right" is not verification.
4. **Root cause over symptom.** If a check fails, fix the shared function once
   rather than the one caller the failure surfaced through.
5. **No faking done.** The marker line is ONLY emitted when the completion
   criterion is verifiably true this iteration. Outputting it falsely is the
   single worst failure mode — it breaks trust in the loop itself.

## Pitfalls (the agent must avoid these)

- **Don't double-arm.** Before arming, check existing terminals for a
  `RAKER_TICK_<PURPOSE>` sentinel. If one is already running, don't start another.
- **Don't change the prompt between iterations.** Only the files change. The
  re-entry prompt is frozen at arm time.
- **Don't summarize around a failing check.** "I think it should work now" is
  not the marker. The marker only fires after the check actually passed.
- **Don't run forever silently.** Each turn ends with a one-line progress note
  (iteration N, what changed, what the check said). Silence means stuck.
- **Don't fake the marker to escape.** If genuinely blocked after many
  iterations, the agent reports the block honestly in the turn — it does NOT
  emit the marker. The loop continues; the user can `pkill` it.
- **Don't arm a wake in addition to a still-running loop.** One shell per purpose.

## Examples

**Example 1 — tests-until-green (inferred completion)**

Input: `/raker get the auth module tests passing`

Parse: no separator. Completion inferred = "the repo's test command for the auth
module exits 0".

Armed line:
```
Raker armed | task: get the auth module tests passing | done-when: auth test suite exits 0 | cap: infinite (kill: pkill -f RAKER_TICK_AUTH_TESTS)
```

Each iteration: read test failures, fix root cause, run the suite, observe.
Marker `RAKER_DONE_AUTH_TESTS` emitted only when the suite exits 0.

**Example 2 — coverage threshold (explicit completion)**

Input: `/raker add unit tests to src/payments until coverage is 80%`

Parse: separator ` until ` → task = `add unit tests to src/payments`,
completion = `coverage is 80%`.

Verification = `npm run test:cov` (or repo equivalent) and parse the coverage
report for `src/payments` ≥ 80%. Marker `RAKER_DONE_PAYMENTS_COV`.

**Example 3 — performance budget**

Input: `/raker optimize startup | p95 cold-start under 200ms`

Parse: separator ` | ` → task = `optimize startup`, completion = `p95
cold-start under 200ms`.

Verification = run the benchmark harness, read the p95 number. Each iteration
takes the smallest step (one allocation removed, one import deferred), re-runs
the harness, observes the number. Marker `RAKER_DONE_STARTUP` only when p95 <
200ms in the actual measured output.

**Example 4 — natural-language stop**

User: "ok stop raker"

Action: `pkill -f RAKER_TICK_.*` (or the specific purpose slug), consume the
shell completion, confirm stopped. No new wake armed.

## Reference

- `STOPHOOK.md` — the ponytail discipline checklist applied each iteration.
