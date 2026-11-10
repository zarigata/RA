# External Benchmarks (Wave 5)

`ra bench external` runs RA against public coding benchmarks headlessly — no
docker-in-docker, no GPU — and reports pass@1 + latency + cost per model.

```
ra bench external <suite> --model <id> [--limit N] [--budget USD] [--cwd DIR] [--local-dir DIR]
```

Suites: `humanevalplus` · `mbppplus` · `polyglot-py`

## Why these suites (selection, Nov 2026)

Selection criteria: (1) task files downloadable as JSON/zip from a stable URL,
(2) deterministic local verifier (unit tests / exact asserts), (3) no GPU, no
docker-in-docker, (4) runnable by an API-driven agent in a scratch dir.

| Suite | Verdict | Why |
| --- | --- | --- |
| **HumanEval+ (v0.1.10)** | ✅ chosen — codegen pass@1 | 164 tasks, single JSONL.gz from a pinned GitHub release; each task carries its own `test` payload + `check()` harness — verification is "append candidate, run python3". The strongest-quality function-completion benchmark that needs zero toolchain beyond python3. |
| **Aider polyglot (python slice)** | ✅ chosen — edit-style | 34 python Exercism exercises (sparse clone, 1.3 MB); each ships a stub + pytest/`unittest` file — an honest edit-the-code task shape that completion benchmarks don't test. Verify = run the exercise's pristine test against the agent's implementation. The other 5 languages (go/rust/java/cpp/js) need their toolchains — out of scope, documented. |
| MBPP+ (v0.2.0) | ✅ implemented, kept as fallback | 378 tasks (1 malformed line skipped — Mbpp/404 embeds a bare `Infinity`, invalid strict JSON), same JSONL.gz + asserts shape; base `assertion` set verified, plus-input grid needs evalplus's ref-execution harness (not shipped). Not run live — it's function-completion like HumanEval+, so the polyglot edit-style suite adds more signal for the same spend. |
| SWE-bench Lite | ❌ | Requires docker per task instance (repo + env image). Explicitly out per plan. |
| Terminal-Bench | ❌ | Task harness expects a terminal-env container per task; docker-centric, heavy. |
| BigCodeBench | ❌ | Function+library tasks, but the official grader pulls per-task library deps (`pip install` per task) — toolchain-heavy, less deterministic offline. |
| LiveCodeBench | ❌ | Competitive-programming prompts rely on their hosted grader; website-driven data collection is unstable for headless automation. |

### Honest caveats discovered while wiring them up

- **py3.9 + non-ASCII**: system python3 is 3.9; HumanEval+/12 and /14 embed
  non-ASCII docstrings — the verifier prepends `# -*- coding: utf-8 -*-`
  (PEP 268/263) or every run "fails" with a SyntaxError that is the harness's
  fault, not the model's.
- **HumanEval/15 is slow by design**: its tests build strings up to n≈1,001,011
  (~7 MB). A 10 s verifier timeout scores every model 0; the adapter uses 60 s
  (`RA_BENCH_TIMEOUT_MS` to override).
- **Local-model fallback footgun**: `runTaskAgent` falls back to localhost
  Ollama when a configured model is unreachable. Live lanes must export
  `RA_LOCAL_ONLY=1` (the e2e pattern) or a mistyped model id silently scores as
  whatever `qwen2.5:1.5b` produces.
- **Polyglot has no canonical prompts**: the agent prompt is composed from
  `.docs/instructions.md` (+ `instructions.append.md`) + the stub, mirroring
  Aider's composition rule. `.meta/` (reference solutions) is never seeded.

## Architecture

- `ra/src/benchmark/external/tasks.ts` — download/parse: pinned-release
  JSONL.gz (HumanEval+/MBPP+), sparse git clone (polyglot), uniform
  `ExternalTask` shape, scratch-dir materialization.
- `ra/src/benchmark/external/verify.ts` — deterministic verification: sandboxed
  python3 subprocess w/ timeout, suite-asserts harness composition, failure
  taxonomy (syntax / wrong-logic / timeout / harness), fenced-block extraction
  fallback from the agent transcript.
- `ra/src/benchmark/external/run.ts` — orchestration: one `runTaskAgent` per
  task with the model pinned across tier/role/router surfaces (the `ra eval`
  pattern), per-task cost/latency, budget stop, JSON report to
  `benchmarks/runs/`.

Task-file caches download once into `benchmarks/.cache/` (gitignored). Results
JSON lives in `benchmarks/runs/` (committed). Offline tests:
`ra/tests/bench-external.test.ts` (fixture mini-tasks per suite, no network).
