# RA .70 agent-team acceptance — 2026-08-30

RA **1.0.0-ra.70** was reinstalled in the separate macOS sandbox and exercised through its `ra` executable and real terminal PTYs. All model work used live Ollama Cloud. No repository unit-test, eval, or benchmark script was used.

## .71 team regression (2026-08-30)

After .71 wired native command sandboxing into agent shells, stdio MCP, diagnostics, verification, and swarm Git, the full 16-scenario team suite was rerun against the reinstalled .71 build (GLM planning/review, DeepSeek implementation, cloud only).

**Result: 16/16 passed in one uninterrupted run** (164.83 summed seconds). Evidence: [evidence/agents-70/regression-71/](evidence/agents-70/regression-71/).

| Scenario | Result | Seconds | Evidence |
|---|---|---:|---|
| 22-team-discovery | PASS | 1.41 | [JSON](evidence/agents-70/regression-71/22-team-discovery.json) |
| 23-bounded-moa | PASS | 14.12 | [evidence/agents-70/regression-71/23-bounded-moa.json](evidence/agents-70/regression-71/23-bounded-moa.json) |
| 24-partial-moa | PASS | 9.76 | [evidence/agents-70/regression-71/24-partial-moa.json](evidence/agents-70/regression-71/24-partial-moa.json) |
| 25-moa-readonly | PASS | 13.13 | [evidence/agents-70/regression-71/25-moa-readonly.json](evidence/agents-70/regression-71/25-moa-readonly.json) |
| 26-shared-call-budget | PASS | 1.45 | [evidence/agents-70/regression-71/26-shared-call-budget.json](evidence/agents-70/regression-71/26-shared-call-budget.json) |
| 27-moa-tui-cancel | PASS | 2.21 | [evidence/agents-70/regression-71/27-moa-tui-cancel.json](evidence/agents-70/regression-71/27-moa-tui-cancel.json) |
| 28-swarm-isolated-apply | PASS | 18.35 | [evidence/agents-70/regression-71/28-swarm-isolated-apply.json](evidence/agents-70/regression-71/28-swarm-isolated-apply.json) |
| 29-swarm-conflict-recovery | PASS | 22.81 | [evidence/agents-70/regression-71/29-swarm-conflict-recovery.json](evidence/agents-70/regression-71/29-swarm-conflict-recovery.json) |
| 30-swarm-validation | PASS | 6.19 | [evidence/agents-70/regression-71/30-swarm-validation.json](evidence/agents-70/regression-71/30-swarm-validation.json) |
| 31-swarm-partial-retained | PASS | 8.74 | [evidence/agents-70/regression-71/31-swarm-partial-retained.json](evidence/agents-70/regression-71/31-swarm-partial-retained.json) |
| 32-swarm-tui | PASS | 13.79 | [evidence/agents-70/regression-71/32-swarm-tui.json](evidence/agents-70/regression-71/32-swarm-tui.json) |
| 33-swarm-cancel-shell | PASS | 14.14 | [evidence/agents-70/regression-71/33-swarm-cancel-shell.json](evidence/agents-70/regression-71/33-swarm-cancel-shell.json) |
| 34-swarm-ownership-reject | PASS | 10.65 | [evidence/agents-70/regression-71/34-swarm-ownership-reject.json](evidence/agents-70/regression-71/34-swarm-ownership-reject.json) |
| 35-pipeline-shared-budget | PASS | 2.49 | [evidence/agents-70/regression-71/35-pipeline-shared-budget.json](evidence/agents-70/regression-71/35-pipeline-shared-budget.json) |
| 36-swarm-target-guard | PASS | 9.86 | [evidence/agents-70/regression-71/36-swarm-target-guard.json](evidence/agents-70/regression-71/36-swarm-target-guard.json) |
| 37-mixed-model-swarm | PASS | 15.72 | [evidence/agents-70/regression-71/37-mixed-model-swarm.json](evidence/agents-70/regression-71/37-mixed-model-swarm.json) |

Companion coding regression: [RESULTS.md](RESULTS.md). Safety extension: [SAFETY_RESULTS.md](SAFETY_RESULTS.md).

## .70 original run

RA **1.0.0-ra.70** was reinstalled in the separate macOS sandbox and exercised through its `ra` executable and real terminal PTYs. All model work used live Ollama Cloud. No repository unit-test, eval, or benchmark script was used.

## Measured result

- **Final team batch: 16/16 passed in one uninterrupted run** (117.30 seconds summed scenario time).
- The first 11-scenario team batch also passed. A subsequently added shell-cancellation scenario exposed a real leaked-child bug; its failure and the corrected rerun are both retained.
- **Original regression batch: 20/21 passed.** The existing-file bug-fix scenario failed during GPT-OSS planning with an upstream Internal Server Error. A same-configuration targeted retry failed again.
- **Explicit GLM planner retest: 1/1 passed** (16.06 seconds), preserving the unrelated sentinel and passing independent Python assertions. This does not turn the GPT-OSS full run into a clean pass.
- The latest passing evidence covers **37 distinct scenarios across batches and stated model configurations**, not one uninterrupted 37/37 run.

## Team scenarios

| Scenario | Result | Seconds | Evidence |
|---|---|---:|---|
| 22-team-discovery | PASS | 1.04 | [JSON](evidence/agents-70/final/22-team-discovery.json) |
| 23-bounded-moa | PASS | 15.41 | [JSON](evidence/agents-70/final/23-bounded-moa.json) |
| 24-partial-moa | PASS | 5.61 | [JSON](evidence/agents-70/final/24-partial-moa.json) |
| 25-moa-readonly | PASS | 6.66 | [JSON](evidence/agents-70/final/25-moa-readonly.json) |
| 26-shared-call-budget | PASS | 4.52 | [JSON](evidence/agents-70/final/26-shared-call-budget.json) |
| 27-moa-tui-cancel | PASS | 2.02 | [JSON](evidence/agents-70/final/27-moa-tui-cancel.json) |
| 28-swarm-isolated-apply | PASS | 10.67 | [JSON](evidence/agents-70/final/28-swarm-isolated-apply.json) |
| 29-swarm-conflict-recovery | PASS | 9.68 | [JSON](evidence/agents-70/final/29-swarm-conflict-recovery.json) |
| 30-swarm-validation | PASS | 3.41 | [JSON](evidence/agents-70/final/30-swarm-validation.json) |
| 31-swarm-partial-retained | PASS | 5.49 | [JSON](evidence/agents-70/final/31-swarm-partial-retained.json) |
| 32-swarm-tui | PASS | 10.64 | [JSON](evidence/agents-70/final/32-swarm-tui.json) |
| 33-swarm-cancel-shell | PASS | 10.58 | [JSON](evidence/agents-70/final/33-swarm-cancel-shell.json) |
| 34-swarm-ownership-reject | PASS | 10.16 | [JSON](evidence/agents-70/final/34-swarm-ownership-reject.json) |
| 35-pipeline-shared-budget | PASS | 1.65 | [JSON](evidence/agents-70/final/35-pipeline-shared-budget.json) |
| 36-swarm-target-guard | PASS | 7.95 | [JSON](evidence/agents-70/final/36-swarm-target-guard.json) |
| 37-mixed-model-swarm | PASS | 11.81 | [JSON](evidence/agents-70/final/37-mixed-model-swarm.json) |

The initial scenario 35 hit the call limit while planning. A [stronger targeted check](evidence/agents-70/strengthened-pipeline/35-pipeline-shared-budget.json) uses GLM planning and additionally requires that planning completes before the shared budget blocks the implementation stage. That check passed in 3.37 seconds. The unchanged source build was used; the original full-batch transcript and driver remain intact.

Scenario 34 is an intentionally contradictory ownership request: the model refused the disallowed path and RA rejected completion without edits. It does not independently prove the post-edit ownership gate against every possible shell side effect.


## Regression evidence

[Full 21-scenario summary](evidence/agents-70/regression-full/summary.json), [original provider failure](evidence/agents-70/regression-full/04-existing-bugfix.json), [same-model retry failure](evidence/agents-70/regression-gpt-retry/04-existing-bugfix.json), and [GLM planner retest](evidence/agents-70/regression-glm-retest/04-existing-bugfix.json).

The four-role pipeline, TUI coding/chat, MoA, undo, session export, authentication failure, symlink rejection, read-only planning, Escape, and conversation continuity all passed in the full regression batch. GPT-OSS planning remains an observed reliability limit for the bug-fix request; there is no silent fallback in these results.

## Behavior established

- Independent read-only proposals return every result, preserve successful output after a failed model, and use a real synthesis call. Results distinguish complete, partial, failed, and cancelled runs.
- Agent calls and nested work share bounded execution scopes. A one-call budget stops additional participants and synthesis; pipeline stages share that budget too.
- Escape cancels a live MoA turn and returns to a usable TUI. Ctrl+C cancels an active swarm shell process group, including a background child that ignores SIGTERM; a queued task never starts.
- Two coding tasks start from the same clean Git commit in separate worktrees. Their modules execute independently after integration. Mixed DeepSeek/GLM tasks record distinct actual model IDs.
- Failed tasks retain worktrees and successful sibling commits. Apply refuses incomplete teams, dirty target checkouts, and branches moved since the swarm began.
- Deliberate same-file merge conflicts remain in a separate integration worktree. The original branch and files stay unchanged. After a manual resolve/commit, the same apply command succeeds.
- CLI JSON remains parseable; TUI commands expose progress, model names, task branches, status, and the agent tree.

## Failure reproduction and fix

The [cancellation reproduction](evidence/agents-70/cancellation-repro/33-swarm-cancel-shell.json) failed because the parent shell exited after SIGTERM, closing its streams, while a background child ignored SIGTERM and wrote `orphan.txt` later. Parent completion had cleared the pending force-kill timer. The corrected cleanup sends SIGKILL to the remaining process group when cancellation or timeout occurred. The [same scenario on the final build](evidence/agents-70/final/33-swarm-cancel-shell.json) passes after waiting beyond the child's scheduled write. The original failure is not overwritten.

## Installation and isolation

- Launcher: `/private/tmp/ra-user-sandbox/bin/ra`; separate source: `/private/tmp/ra-user-sandbox/app`. The installer ran with a sandbox HOME and install directory.
- Seatbelt confines writes to the sandbox and terminal devices. It permits reads/networking; it is not a VM or a built-in RA security boundary.
- Each scenario uses a fresh HOME and project. Git fixtures, task commits, integration commits, and manual conflict resolutions occur only in disposable sandbox repositories. The RA project was not committed or published.
- Planning and synthesis: `gpt-oss:120b`; coding: `deepseek-v4-pro:0813`; review: `glm-5.3-flash`. The mixed swarm also uses GLM for a coding task.
- Python bytecode writing is disabled in team fixtures so it does not pollute ownership assertions. Independent program checks use `python3 -B`. This is an explicit test-environment setting.
- [Installed source hashes](evidence/agents-70/installed-manifest.json) cover 62 source files; the installed copy matches the workspace sources. [Installer record](evidence/agents-70/install.json).
- Credentials are read privately into process environments and filtered from evidence. Exact-key scans of changed code and saved evidence found no credential.

## Limits

Passing these small scenarios does not establish superiority to Codex, OpenCode, or Claude Code, or complete feature parity. The broader goal remains open.

Worktrees isolate normal edits but do not sandbox arbitrary shell commands; `files` ownership is checked before commit. Ordinary nested agents do not yet inherit every parent frontmatter restriction (MoA uses shared deny rules to prevent that escalation). Cancellation across MCP, diagnostics, plugins, and independently concurrent daemon sessions still needs implementation and acceptance. Task execution cannot yet resume after a crash; integration can resume after a resolved conflict. Retained worktrees need explicit Git cleanup. No Windows/Linux, full internal CI, long-context, remote/IDE, or hostile-repository certification is implied. See [NEXT.md](NEXT.md).
