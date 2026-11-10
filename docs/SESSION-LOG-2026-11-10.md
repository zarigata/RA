# Session Log — RA Hardening Program, 2026-11-10

A detailed log of everything that went wrong (or nearly went wrong) during the
six-wave hardening program, written at the user's request so the same failure
modes can be recognized — and prevented — next time. Every entry below was
live-observed during the program; commits are the fixes, tests are the pins.

**Classes:** `endpoint` (upstream AI services) · `harness` (eval/benchmark
tooling around RA) · `product` (RA itself) · `test-env` (CI, isolation,
fixtures).

**Naming rule:** private servers are referred to by role — *the LAN model
server (private)* and *the private cloud gateway* — never by address.

---

## Failure catalog

| # | Failure | Class | Symptom | Root cause | Fix | Prevention |
|---|---|---|---|---|---|---|
| 1 | **E1 rate-limit cascade** | endpoint | Eval sweeps on the LAN model server (private) collapsed mid-sweep (9/21) with cascading 429s | Burst traffic from parallel wave agents overwhelming a small private server — a discipline problem, not a server-down problem | Serialized runs, ≥60 s gaps between sweeps | 4 consecutive sweeps with **zero** 429s after serialization; treat 429-storms as pacing bugs first |
| 2 | **E2′ per-minute request cap** | endpoint | Two 5-token probe calls to the private cloud gateway returned `429 rate_limit_exceeded: maximum 30 requests in 1 minutes` | Account-level concurrency cap hit while other traffic ran on the same account | `withRetry` absorbed equivalent 429s during real runs; serial pacing | No run ever failed of it; keep probe traffic off an account mid-run |
| 3 | **Replica-inconsistent model routing** | endpoint | The *same* typo'd model id was served (silently aliased to `claude-sonnet-5-5`) twice, then rejected with `model_not_available` an hour later | The gateway's replicas disagree on alias resolution — endpoint-side flake | **F1 guard** (product-side): unknown provider-prefixed `--models` ids fail fast listing configured models (419c0c5) | Never trust endpoint aliasing for typed ids; registry check before spend (pin: `ra/tests/moa-layers.test.ts`) |
| 4 | **503 overload outage — cost a benchmark run** | endpoint | Wave 5 HumanEval+ first full run: 8 tasks "failed" as `error → harness "solution.py missing/empty"` at ~0.7 s each | The private cloud gateway returned `503 system cpu overloaded 99%+`; the model never answered, and the fast-fail landed in the harness bucket | Entire report discarded; canary re-run, then full re-run after recovery — final 20/20 | Canary before full runs; budget caps + re-run discipline (documented in `benchmarks/RESULTS.md`); treat *fast-fail harness misses* as endpoint-suspect, not model failures |
| 5 | **502 XML syntax error on tool-call streams** | endpoint | Critic turns (maat, sekhmet) lost mid-run against the LAN model server | Server-side stream corruption on tool-call XML; single configured provider → no fallback to absorb | RA reported the loss honestly (no manufactured success) | Multi-provider fallback chains (ra.72) absorb this when configured; honest failure beats fake success |
| 6 | **F1 moa silent aliasing — mislabeled spend** | product | Typo'd `--models codder/claude-sonnet-5-30` ran on whatever the endpoint aliased it to; the result card reported the typo'd id `status: completed, estCostUsd: 0` while real tokens were spent | `runLayeredMoa` accepted any string; the endpoint silently aliased it | Registry check: unknown provider-prefixed ids exit 1 with the configured-model list; $0 spent (419c0c5) | Proven live post-fix; regression pin in `ra/tests/moa-layers.test.ts` |
| 7 | **F2 eval verify-file copy-paste** | harness | `sum-function` "stably failed" across **six** sweeps — looked like a model limitation | The verify step read `hello.py` (copy-pasted from the hello-function task); the task was unwinnable | Prompt + verify now name `add.py` (419c0c5) | New pin: verify-file ↔ prompt agreement test (`ra/tests/eval.test.ts`) |
| 8 | **F3 unseeded fix-* tasks** | harness | `fix-missing-print` / `fix-off-by-one` failed every sweep (one was "unwinnable-by-luck") | Prompts described pre-existing buggy files the fresh eval dir never contained | `EvalTask.seed` + seeded buggy `hello.py`/`range.py` fixtures (419c0c5) — post-fix sweep **21/21** | Pins: seed presence + pre-fix-state-fails-verify |
| 9 | **F4 pipeline planner fragility — 60% failure** | product | Dual-lane pipeline failed **3/5** runs on a trivial task, identical signature: small-model planner (read-only, `steps: 10`) loops tool calls in an empty dir until the step limit; the whole pipeline aborted | Planner-stage step-limit exhaustion was propagated as a fatal pipeline error | Advisory stages (thoth/maat/sekhmet/seshat) **degrade gracefully** — partial prose passes through, empty output gets an explicit degraded note, ptah proceeds from the goal (4215fbc). Wave 3c re-runs: 3/3 completed | `ra/tests/pipeline-stability.test.ts` (200 lines of pins) |
| 10 | **F5 lane model override gap** | product | An explicitly forced `agent.general.model` was silently replaced by the small lane on the assistant path while the card kept the forced id | Assistant path hardcoded `config.small_model ?? config.model`, ignoring the pin (same family as F1) | `resolveAssistantModel` priority: general pin → small → default (4215fbc) | Pin in `ra/tests/assistant-lane.test.ts` |
| 11 | **F6 usage.json cross-talk + corruption** | product+harness | The global `~/.ra/usage.json` recorded *concurrent agents'* traffic (spend attribution bled across waves); a torn write could corrupt it | Shared global file, plain `writeFileSync`, no quarantine on corrupt read | `writeJsonAtomic` (tmp + `rename(2)`), corrupt files quarantined, tolerant read (4215fbc) | Atomic-write pin; per-process attribution remains a named ceiling |
| 12 | **RA_CONFIG ambient-env clobber — struck twice** | harness | `/tmp` wave configs (`ra-dual.json`) were clobbered after Wave 2, then again during Wave 3c test runs — the "config is infrastructure" lesson, twice | An ambient `RA_CONFIG` in the e2e shell redirected a *test's* `loadRaConfig` AND `saveRaConfig` into the live wave config | Tests clear `RA_CONFIG` in `beforeEach` (e57bc1f), mirroring `config-malformed.test.ts`; clobbered copy preserved as `.bak` | Never trust ambient env in tests; back up wave configs before writing; the wave configs ARE infrastructure |
| 13 | **Mistaken `--amend` incident** | harness | A wave agent amended an existing commit instead of adding a new one, rewriting the Wave 5 (and earlier the Wave 3c) commit | `--amend` muscle-memory in a multi-agent repo where commits are coordination units | Restored via `git reset` to the pre-amend commit (reflog) | Never `--amend` commits outside your own wave; the reflog is the recovery path; when in doubt, commit anew |
| 14 | **Opencode fixture endpoint leak — caught pre-push** | test-env | A real private endpoint URL sat in `ra/tests/fixtures/parity/opencode/opencode.json` | The fixture was captured verbatim from a real store config | Scrubbed to `example.test` **before** any push (b54c0c0) | Pre-push secret scan is a release gate (this wave's Phase 2 scrub institutionalizes it); fixtures must be sanitized at capture time |
| 15 | **CRLF silent metadata loss** | product | Windows-authored `SKILL.md`/agent/command/rules files loaded with **no metadata at all** — name, description, permissions gone, no error | Strict `\n`-only frontmatter regexes never matched `\r\n` files | `\r?\n` across all six parsers (skills, agents, commands, rules, agent permissions/meta) (f5ce35c) | `ra/tests/crlf-frontmatter.test.ts` pins all six surfaces |
| 16 | **TOML comment-stripping data loss** | product | Codex `config.toml` lines like `key = "v" # note` were skipped as "unsupported" — keys silently dropped | Comment stripper saw quotes before `#` and kept the comment, making the value unparseable (fail-closed, but wrong) | Quote-parity check: strip `#` only when quotes before it are balanced (f5ce35c) | Parser corpus + 12 mutators property suite (`ra/tests/`, Wave 3a) |
| 17 | **`/sessions` transcript leak** | product | Daemon `GET /sessions` returned **full session transcripts** (424 KB payload for ~a dozen sessions) — a privacy/scalability gap | The list endpoint serialized whole session objects | Metadata-only rows: 160-byte payload, zero message bodies, no secret material (66c0674) | Live regression: POST a secret message, assert GET /sessions never returns bodies |
| 18 | **Provider isolation leak via localhost fallback** | product | An isolated e2e run listed the dev machine's *real* localhost Ollama models | `pickOllamaEndpoint`'s hardcoded `localhost:11434` fallback probed the real server when the test server didn't answer native `/api/tags` | `RA_LOCAL_ONLY=1` drops the fallback — unconfigured probes fail honestly (ecb69d4) | Harness and benchmark runs set `RA_LOCAL_ONLY=1`; isolation tests assert no ambient-model discovery |
| 19 | **Dangling symlink crash** | product | One broken symlink in the project dir killed the whole agent turn **before any model call** | `listDir` used `statSync` (follows links) → ENOENT on broken links | `lstat`; broken links list as `l` (ecb69d4) | Regression pin; part of the empty-project/edge-case suite (Wave 3a) |
| 20 | **Cloud-gateway lanes misrouted as local** | product | Paid cloud lanes (e.g. `codder/*`) inherited the +2 local routing bonus and the 32 k local context cap; balanced-mode escalation never targeted them; quota marks landed under a key the router never checked | Lane kind inferred from id prefix only; provider-block baseURL ignored | Provider block's baseURL decides local/cloud across the stack; quota marked under the provider-prefixed id (ecb69d4) | Mosaic + routing test battery; provider blocks are OpenAI-compat by contract |
| 21 | **Wave 4's 22 "failures" that were driver bugs** | test-env | First at-scale conformance pass reported 22 entries failing ("agent not in catalog", "command not dispatchable") — implying import was broken | The *driver's* verification step ran catalog/commands/skills loaders that didn't honor the `RA_PLUGIN_HOME` isolation seam — imports landed in the isolated home while verification read the real home | `RA_PLUGIN_HOME` seam extended to skills/command/agent catalog loaders (c30064e) → final **264/264 pass** | When a conformance run fails *en masse*, suspect the harness seam before the product; verify the verifier itself |
| 22 | **Windows CI portability (first 3-OS runs)** | test-env | The new ubuntu/macos/windows matrix ran red on Windows: hook-shim hardcoded `/bin/sh`; quota test used `/tmp`; five test files spawned `"bun"` by name; symlink/`env -i` tests are POSIX-only | Unix assumptions baked into tests and shims | `sh` on win32; `os.tmpdir()`; `process.execPath`; in-test platform guards (c30064e) | Platform guards keep suites runnable on any dev box, not just CI; `scripts/offline-tests.txt` is the single source of truth |
| 23 | **Pricing-unwired $0-cost bug** | harness | External benchmark runs reported `$0.0000` per task and $0 total on a **paid** lane — costs silently absent | The bench harness never passed provider pricing overrides into the run config; unknown models price $0 by default | Overrides wired (5cf2d24) — real costs appeared immediately ($1.67 total across the wave) | Never trust a $0 line on a paid lane; cost-override path is unit-pinned |

## Near-misses and lessons that didn't get a row

- **Wave-config backups.** The Wave 3b pre-flight found `/tmp/ra-e2e/*.json`
  clobbered post-Wave-2; the proven dual-lane config had to be reconstructed
  from prior-wave evidence. Rule adopted: wave agents must not write the
  shared `/tmp` configs without a `.bak` (row 12).
- **Score noise ≠ model noise.** Sweep-to-sweep eval variance (19/17/18 out of
  21) decomposed into two harness bugs (rows 7–8), two genuinely flaky
  model-variance tasks, and zero endpoint failures. Post-fix: 21/21
  repeatable. Always decompose variance before blaming the model.
- **Unattended-trust ladder.** The program ended with: serialized LAN evals
  **trusted**, cloud micro/moa **trusted**, dual-lane pipeline trusted *after*
  F4 (rows 9) — previously 60% failure. Trust is earned per lane, per task
  shape, with receipts.
- **Fail-fast beats silent aliasing.** Rows 3, 6 and 10 are the same lesson at
  three layers: endpoint, CLI flag, config pin. Typed ids are checked against
  the registry; ambiguity exits 1 instead of spending money under a wrong
  label.
- **Pre-push scrub is a phase, not an afterthought.** Row 14 caught a leak in
  fixtures; this wave's tree + history scrub (replace-text over the release
  range, verified with `git grep` across every revision) is the
  institutionalized version. Keys were already clean (Cycle 43 purge
  precedent); endpoints and addresses got the same treatment.

## What did not go wrong (for the record)

- No secret key material was ever committed during the program (verified by
  prefix scans across the full history before push).
- No test suite regression survived a wave: every wave landed with ra +
  anubis suites green and `verify-release.sh` (under `env -i`) exit 0.
- No manufactured successes: every endpoint-caused loss (rows 4, 5) was
  reported as a loss and re-run, never papered over.

## Sources

Wave evidence lives locally under `/tmp/ra-e2e/` (E2E phases, Waves 2–3c:
`WAVE*-RESULTS.md`, `logs/`, work dirs) and `/tmp/ra-parity/` (Waves 4–5:
`WAVE4-PLUGINS.md`, `FINAL-REPORT.md`, `PARITY-SCOREBOARD.md`, `wave5-logs/`).
Commit messages for waves 1–5 carry the per-wave detail; this log is the
cross-wave distillation.
