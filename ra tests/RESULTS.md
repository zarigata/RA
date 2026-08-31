# RA installed-user acceptance — 2026-08-30

For the subsequent .70 team features and regression run, see [AGENT_RESULTS.md](AGENT_RESULTS.md). This report preserves the .69 results, records the .71 coding regression, and the .72 fallback feature.

## .72 explicit model fallbacks (RA 1.0.0-ra.72, 2026-08-30)

New feature: provider failures (timeouts, 5xx, stream errors, unknown model) now retry down an explicit user-configured fallback chain — per-model or default entries in `RA_CONFIG` `fallbacks`, or `RA_FALLBACK` / `RA_SMALL_FALLBACK`. Candidates are same-host-kind only (a cloud selection never silently degrades to LAN/local), authentication failures and user cancellations fail loudly without fallback, and every switch is attributed on stderr (JSON-safe), in the TUI stream, and in `ra last --json`.

Installed-user scenarios (`fallback_acceptance.py`, installed binary, live Ollama Cloud, missing primary model `ra-acceptance-missing-model`):

| Scenario | Result | Seconds | Evidence |
|---|---|---:|---|
| 61-fallback-attribution-cli | PASS | 4.85 | [JSON](evidence/fallback-72/61-fallback-attribution-cli.json) |
| 62-fallback-default-chain | PASS | 9.79 | [JSON](evidence/fallback-72/62-fallback-default-chain.json) |
| 63-auth-no-fallback | PASS | 0.36 | [JSON](evidence/fallback-72/63-auth-no-fallback.json) |
| 64-fallback-tui | PASS | 3.33 | [JSON](evidence/fallback-72/64-fallback-tui.json) |

- 61 proves `RA_FALLBACK` cloud-to-cloud recovery with visible attribution on stderr and per-stage `fallbacks` records in `ra last --json`.
- 62 proves the `fallbacks.default` config chain (primary missing → gpt-oss:120b).
- 63 proves an invalid API key fails with no artifact, no fallback, and a `failed` last-run record.
- 64 proves the TUI stream shows the fallback notice and the generated module still passes an independent check.
- One intermediate 62 attempt failed on a gpt-oss implementer flake (task written and verified, but the stage hit its step limit because the model glued `DONE` onto tool output). The rerun passed. This is the same model-behavior reliability limit documented since .69; the fallback mechanism itself worked in both attempts.

The unit suite is fully green for the first time since .71: 360/360 (`ra tests/fallback.test.ts` adds 9 cases). Four pre-existing unit failures were fixed: verify tests missing `cwd` in last-run fixtures, project-memory fixtures written through the (correctly) blocked AGENTS.md write guard, the swarm fixture placing worktrees outside the sandboxed workspace, and the swarm fake agent committing instead of leaving staging to RA.

Competitive evidence on real repositories (priority 8) starts separately with [competitive_acceptance.py](competitive_acceptance.py) and is recorded in [COMPETITIVE_RESULTS.md](COMPETITIVE_RESULTS.md).

## .71 regression (RA 1.0.0-ra.71, 2026-08-30)

The .71 build added native command sandboxing to every agent shell. To prove those changes did not break the coding flows, the same 21-scenario installed-user suite was rerun against the reinstalled .71 build with GLM planning/review and DeepSeek implementation on Ollama Cloud.

**Result: 21/21 passed in one uninterrupted run** (185.48 summed seconds). Evidence: [evidence/regression-71/](evidence/regression-71/).

A separate interactive manual pass with the same installed binary and key confirmed everyday operation outside the drivers: `ra doctor` (cloud reachable, 19 models), `ra env`, `ra agents`, `ra sandbox status`, then a live `ra run "Create converter.py …" --quick --verify` in a fresh scratch project (12.6 s; file written, executed under the native sandbox with network denied, output `212.0`, verify OK), `ra timings` / `ra files` / `ra sessions`, and a two-role `ra moa` that returned a real synthesis with per-role models, conflict notes, and a preserved partial disagreement.

| Scenario | Result | Seconds | Evidence |
|---|---|---:|---|
| 01-installed-help | PASS | 0.84 | [JSON](evidence/regression-71/01-installed-help.json) |
| 02-python-cloud | PASS | 11.98 | [evidence/regression-71/02-python-cloud.json](evidence/regression-71/02-python-cloud.json) |
| 03-multifile-js | PASS | 6.55 | [evidence/regression-71/03-multifile-js.json](evidence/regression-71/03-multifile-js.json) |
| 04-existing-bugfix | PASS | 7.39 | [evidence/regression-71/04-existing-bugfix.json](evidence/regression-71/04-existing-bugfix.json) |
| 05-project-memory | PASS | 11.17 | [evidence/regression-71/05-project-memory.json](evidence/regression-71/05-project-memory.json) |
| 06-write-and-run-tests | PASS | 20.64 | [evidence/regression-71/06-write-and-run-tests.json](evidence/regression-71/06-write-and-run-tests.json) |
| 07-typescript | PASS | 18.82 | [evidence/regression-71/07-typescript.json](evidence/regression-71/07-typescript.json) |
| 08-json-edit | PASS | 6.68 | [evidence/regression-71/08-json-edit.json](evidence/regression-71/08-json-edit.json) |
| 09-documentation | PASS | 10.24 | [evidence/regression-71/09-documentation.json](evidence/regression-71/09-documentation.json) |
| 10-four-agent-pipeline | PASS | 31.11 | [evidence/regression-71/10-four-agent-pipeline.json](evidence/regression-71/10-four-agent-pipeline.json) |
| 11-tui-cloud-chat | PASS | 2.35 | [evidence/regression-71/11-tui-cloud-chat.json](evidence/regression-71/11-tui-cloud-chat.json) |
| 12-tui-code-tree | PASS | 6.27 | [evidence/regression-71/12-tui-code-tree.json](evidence/regression-71/12-tui-code-tree.json) |
| 13-multi-model-moa | PASS | 17.95 | [evidence/regression-71/13-multi-model-moa.json](evidence/regression-71/13-multi-model-moa.json) |
| 14-undo-original | PASS | 7.27 | [evidence/regression-71/14-undo-original.json](evidence/regression-71/14-undo-original.json) |
| 15-auth-failure-no-placeholder | PASS | 1.83 | [evidence/regression-71/15-auth-failure-no-placeholder.json](evidence/regression-71/15-auth-failure-no-placeholder.json) |
| 16-session-export | PASS | 1.29 | [evidence/regression-71/16-session-export.json](evidence/regression-71/16-session-export.json) |
| 17-cli-errors | PASS | 1.24 | [evidence/regression-71/17-cli-errors.json](evidence/regression-71/17-cli-errors.json) |
| 18-symlink-boundary | PASS | 0.57 | [evidence/regression-71/18-symlink-boundary.json](evidence/regression-71/18-symlink-boundary.json) |
| 19-readonly-planner | PASS | 12.23 | [evidence/regression-71/19-readonly-planner.json](evidence/regression-71/19-readonly-planner.json) |
| 20-tui-cancellation | PASS | 2.37 | [evidence/regression-71/20-tui-cancellation.json](evidence/regression-71/20-tui-cancellation.json) |
| 21-conversation-context | PASS | 6.69 | [evidence/regression-71/21-conversation-context.json](evidence/regression-71/21-conversation-context.json) |

The four-agent pipeline ran 31.11 seconds under native sandboxing versus 84.37 seconds in the .69 run; one clean pass is not a guaranteed pass rate. Companion team regression: [AGENT_RESULTS.md](AGENT_RESULTS.md). Safety extension: [SAFETY_RESULTS.md](SAFETY_RESULTS.md).

## .69 original run

RA **1.0.0-ra.69** was installed in a separate macOS directory and exercised through the installed `ra` command and real PTYs, using live Ollama Cloud for AI work. No existing repository test, eval, or benchmark script was used as evidence.

## Result

- **Uninterrupted full run: 20/21 passed.** The four-agent pipeline failed when the GPT-OSS reviewer received an Ollama Internal Server Error. That failure is retained in `evidence/full-run/10-four-agent-pipeline.json`.
- **Targeted mixed-model retest: 2/2 passed.** With GLM reviewers, both the four-agent pipeline and MoA synthesis passed. The pipeline took 84.37 seconds; synthesis took 24.33 seconds.
- **Latest per-scenario evidence: 21/21 passed**, collected across the full run and the explicit reviewer retest. This is not a claim of an uninterrupted 21/21 run or a guaranteed pass rate.
- A prior four-agent GPT-OSS run also passed, but repeated later upstream failures persisted after one bounded retry. Model/provider behavior is an observed reliability limit.

## Scenario evidence

| Scenario | Latest result | Seconds | Transcript |
|---|---|---:|---|
| 01-installed-help | PASS | 0.36 | [JSON](evidence/final/01-installed-help.json) |
| 02-python-cloud | PASS | 6.35 | [JSON](evidence/final/02-python-cloud.json) |
| 03-multifile-js | PASS | 10.05 | [JSON](evidence/final/03-multifile-js.json) |
| 04-existing-bugfix | PASS | 17.16 | [JSON](evidence/final/04-existing-bugfix.json) |
| 05-project-memory | PASS | 13.45 | [JSON](evidence/final/05-project-memory.json) |
| 06-write-and-run-tests | PASS | 11.86 | [JSON](evidence/final/06-write-and-run-tests.json) |
| 07-typescript | PASS | 12.71 | [JSON](evidence/final/07-typescript.json) |
| 08-json-edit | PASS | 10.72 | [JSON](evidence/final/08-json-edit.json) |
| 09-documentation | PASS | 20.58 | [JSON](evidence/final/09-documentation.json) |
| 10-four-agent-pipeline | PASS | 84.37 | [JSON](evidence/final/10-four-agent-pipeline.json) |
| 11-tui-cloud-chat | PASS | 1.85 | [JSON](evidence/final/11-tui-cloud-chat.json) |
| 12-tui-code-tree | PASS | 7.18 | [JSON](evidence/final/12-tui-code-tree.json) |
| 13-multi-model-moa | PASS | 24.33 | [JSON](evidence/final/13-multi-model-moa.json) |
| 14-undo-original | PASS | 15.18 | [JSON](evidence/final/14-undo-original.json) |
| 15-auth-failure-no-placeholder | PASS | 0.73 | [JSON](evidence/final/15-auth-failure-no-placeholder.json) |
| 16-session-export | PASS | 0.70 | [JSON](evidence/final/16-session-export.json) |
| 17-cli-errors | PASS | 0.57 | [JSON](evidence/final/17-cli-errors.json) |
| 18-symlink-boundary | PASS | 0.35 | [JSON](evidence/final/18-symlink-boundary.json) |
| 19-readonly-planner | PASS | 6.01 | [JSON](evidence/final/19-readonly-planner.json) |
| 20-tui-cancellation | PASS | 1.75 | [JSON](evidence/final/20-tui-cancellation.json) |
| 21-conversation-context | PASS | 3.24 | [JSON](evidence/final/21-conversation-context.json) |

## Models and isolation

- Planning/chat/synthesis: `gpt-oss:120b`. Implementation: `deepseek-v4-pro:0813`. The targeted mixed team used `glm-5.3-flash` for maat/sekhmet review roles.
- Final AI coding results recorded only the `cloud` host. Offline help, session, argument, and path-safety cases do not require a model request. The invalid-key case deliberately expects authentication failure.
- Installed launcher: `/private/tmp/ra-user-sandbox/bin/ra`. Separate source copy: `/private/tmp/ra-user-sandbox/app`.
- macOS Darwin 24.6.0 x86_64; Bun version and SHA-256 source hashes are in `evidence/install-manifest.json`.
- Fresh project and HOME per scenario. Old fixture directories are archived. File writes were confined by Seatbelt; a negative write probe outside the sandbox was denied. The policy permits reads and networking and is not a VM.
- API key loaded privately; changed source and saved evidence were scanned for the exact key. No key was found. The credential was not written into the installed configuration.

## What changed

1. Exported credentials/model choices now reach every execution path; `RA_CONFIG` supports external user configuration. Explicit cloud model choices are not silently replaced by a local model.
2. CLI coding uses the file-aware agent loop, with project memory, file tools, actual execution, and checkpoints. Live CLI/benchmark paths no longer manufacture placeholder success files.
3. Provider adapters normalize DeepSeek XML and native tool-call forms through permission checks. Trailing stream events and provider errors are handled; textual internal-server errors get the existing bounded transient retry.
4. Planner/reviewer tool hints respect permissions. The tool-result prompt no longer tells read-only agents to write files. Unfinished edit tasks and exhausted loops fail explicitly.
5. Markdown writes preserve nested fences. Edits require a unique target and redact known secret formats. Undo retains the original snapshot; symlink paths outside the project are rejected.
6. TUI commands recover after errors, Escape cancels active model requests, recent conversation context is carried forward, help is grouped, and actual MoA role/model participants are shown.
7. `ra run --json --verify` retains parseable stdout and separates diagnostics. Verification status is persisted. Valid Python need not print hello; JS/TS syntax is checked.

## Baseline and failures

The baseline cloud-configured `calc.py` request took 85.54 seconds, silently used local Gemma, wrote `hello.py`, and exited zero. The corrected task created the requested module on cloud and passed independent arithmetic assertions. Earlier failure evidence includes empty/errored streams, unrecognized DeepSeek tool calls, truncated Markdown, and a read-only reviewer being prompted to edit.

Test-environment failures are also retained: Seatbelt initially blocked PTY allocation, and the first PTY driver needed correct EOF draining. These were harness defects, not evidence of RA model failure.

## Limits and next work

The result covers small representative tasks, not feature parity or superiority to Codex, OpenCode, or Claude Code. The broader goal remains open. See [NEXT.md](NEXT.md).

Not validated here: the existing full internal test suite, remote daemon/IDE/LSP and MCP integrations, worktree merge recovery, long-context compaction, multi-session concurrent persistence, all provider models, or other operating systems. Python verification executes files with a time limit; JS/TS syntax checks do not prove behavior. Independent program assertions were used in the relevant scenarios.

Normal RA shell execution is not automatically OS-sandboxed. Escape covers active model requests, not every possible external command. The symlink check is a filesystem guard, not a full adversarial security audit. No release, deployment, commit, or PR was published.

## Reproduce the mixed-model retest

After the isolated install described in [README.md](README.md), export the key privately and run:

```sh
sandbox-exec -f /private/tmp/ra-user-sandbox/policy.sb \
  python3 /private/tmp/ra-user-sandbox/terminal_acceptance.py \
  --review-model ollama-cloud/glm-5.3-flash \
  --only 10-four-agent-pipeline,13-multi-model-moa
```

The optional cloud team configuration is in [cloud-team.example.json](cloud-team.example.json); select it with `RA_CONFIG`. Leave `RA_SMALL_MODEL` unset when you want the individual reviewer assignments from that file.
