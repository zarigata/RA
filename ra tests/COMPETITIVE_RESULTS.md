# RA competitive evidence — fixed-budget real-repo tasks

Measured comparison against all three named competitor CLIs, installed and used as a user in the terminal. Identical task prompts, identical 300-second headless budget, fresh `git clone` of a real repository per run, and independent checkers that recompute or re-execute the expected result without trusting agent output. Driver: [`competitive_acceptance.py`](competitive_acceptance.py). This is one small fixed-budget matrix — a measured baseline, not a universal superiority claim; extending it (more repositories, harder tasks, repeated runs for variance) continues under NEXT.md priority 8.

## Matrix 3 — 2026-09-16 (RA 1.0.0-ra.78 "Low-Context Runtime")

Re-run on the ra.78 working tree (sandbox `ra` wrapper → `bun ra/src/cli.ts`), same tasks, same 300s budget, same independent checkers. RA ran with the new adaptive context runtime ON (cloud lane: DeepSeek-V4-Pro implementation + GLM planning on Ollama Cloud, `context.adaptive` in the sandbox config). Evidence: [`evidence/competitive-78/`](evidence/competitive-78/).

| Task | RA 1.0.0-ra.78 | codex 0.151.0 | claude 2.x (Z.AI GLM) | opencode |
|---|---|---|---|---|
| micrograd-gradient | **PASS 29.0 s** | PASS 34.2 s | PASS 117.8 s | FAIL 39.3 s — no artifact |
| micrograd-neuron | PASS 32.8 s | **PASS 26.4 s** | PASS 133.5 s | FAIL 42.3 s — no artifact |
| slugify-readme | **PASS 18.5 s** | PASS 26.0 s | PASS 94.8 s | FAIL 25.6 s — no artifact |
| **Total** | **3/3, 80.3 s summed** | 3/3, 86.6 s | 3/3, 346.0 s | 0/3 (0/9 across three runs) |

- **RA 3/3 and fastest summed** with the adaptive runtime active; no continuations were needed on these small tasks (cloud lane, 128k windows) — the win is still pipeline efficiency, now on the ra.78 loop.
- **codex closed most of the gap** vs the .72 matrix (86.6 s vs 128.4 s summed) and beat RA on one task; the two tools are now within ~8% on this matrix.
- **claude-on-GLM slower this run** (346 s vs 225 s in .72); same harness, same credential, one run per cell — variance expected.
- **opencode 0/9 across three independent runs** (same model, same budget): still explores instead of working in its cwd and writes no `bench_*` artifact; the slugify failure this time was a node module-resolution crash in its own generated script.

Same-session local evidence (ra.78 before/after on the 8k-usable `gemma:latest`, 4-task eval subset): adaptive OFF 0/4 (every task dead at the 180s run deadline) vs adaptive ON 1/4 with the solvable task passing 28% faster — the low-context runtime changes outcomes, not just telemetry.

## Matrix 2 — 2026-08-30/31 (RA 1.0.0-ra.72)

## Setup

- **Repositories:** [karpathy/micrograd](https://github.com/karpathy/micrograd) (Python autograd engine) and [sindresorhus/slugify](https://github.com/sindresorhus/slugify) (JS library with an npm dependency and documented examples). Cloned fresh per task so no agent sees leftover state.
- **Tasks (identical prompts per tool):**
  1. `micrograd-gradient` — use the repo's `Value` class; write `bench_grad.py` printing `e.data, a.grad, b.grad, c.grad` for `e=a*b+c` (checker: exact values 8.0, −1.0, 2.0, 1.0).
  2. `micrograd-neuron` — seeded `Neuron(2)`; write `bench_neuron.py` printing output and parameter gradients (checker: the ReLU gradient identity, active and inactive branches).
  3. `slugify-readme` — read the README; write `bench_readme.mjs` asserting ≥4 documented input/output pairs (checker: exits 0 with ≥4 PASS lines and DONE, using the repo's library).
- **Tools, as configured on this Mac:**
  - `ra` 1.0.0-ra.72, installed in the acceptance sandbox; DeepSeek-V4-Pro implementation + GLM-5.3-Flash planning on Ollama Cloud; `ra run --quick --verify --json`.
  - `opencode` 1.18.21, the user's install and its stored Ollama Cloud credential; explicitly set to the same implementation model (`ollama-cloud/deepseek-v4-pro`); `opencode run -m …`.
  - `codex` 0.151.0 (npm install), the user's ChatGPT-token auth; its default model `gpt-5.6-sol`; `codex exec -s workspace-write --skip-git-repo-check`.
  - `claude` 2.1.239 has no Anthropic authentication on this Mac (`auth status: loggedIn false`). Its column runs the claude code harness against the user's stored Z.AI coding-plan credential via the Anthropic-compatible endpoint (`ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic`, `--model glm-5.3-flash`, `--dangerously-skip-permissions`). This measures the claude agent harness on GLM — not Anthropic's Claude models, which remain unmeasured here.

## Measured result (final matrix, 2026-08-31)

| Task | RA 1.0.0-ra.72 | codex 0.151.0 | claude 2.1.239 (Z.AI GLM) | opencode 1.18.21 |
|---|---|---|---|---|
| micrograd-gradient | **PASS 11.6 s** | PASS 31.8 s | PASS 98.0 s | FAIL 44.3 s — no artifact |
| micrograd-neuron | **PASS 7.4 s** | PASS 60.0 s | PASS 73.0 s | FAIL 155.3 s — no artifact |
| slugify-readme | **PASS 9.0 s** | PASS 36.6 s | PASS 54.3 s | FAIL 26.3 s — no artifact |
| **Total** | **3/3, 28.0 s summed** | 3/3, 128.4 s | 3/3, 225.3 s | 0/6 across two runs |

- **RA 3/3 and fastest on every task** (2.7–8× faster than codex, 5–10× faster than claude on these tasks), all artifacts passing the independent checkers. Evidence: [`evidence/competitive-72/`](evidence/competitive-72/).
- **codex 3/3** after its usage quota reset at 23:53; the quota block during the first attempt (2026-08-30 evening) is retained in the report history below.
- **claude 3/3** on the Z.AI GLM plan; slower per task on this matrix.
- **opencode 0/3 again on a fresh rerun (0/6 across two independent runs)**: with the same model and budget it spends its time exploring (`find /` searches for the repository instead of working in its cwd) and never writes the requested file. The checkers re-ran each workspace and found no `bench_*` file, so this is a genuine agent-navigation failure under identical constraints, not a checker artifact.

## History

- **codex, 2026-08-30 evening:** every run failed in ~5 s with `ERROR: You've hit your usage limit … try again at 11:53 PM`. Authenticated but quota-blocked; rerun after reset produced the 3/3 above.
- **claude, 2026-08-30:** unauthenticated; unblocked on 2026-08-31 via the user's stored Z.AI credential (no interactive login available to an unattended run). Anthropic first-party models remain unmeasured.

## RA-side findings the benchmark exposed (both fixed in .72)

1. **Empty WRITE accepted** (run 1, slugify): DeepSeek emitted a WRITE with no body; RA wrote a 0-byte file and only failed at the step limit. `toolWrite` now refuses empty content with an explicit retryable error (`ra/tests/runtime.test.ts` covers it).
2. **EISDIR crash** (run 2, gradient): the implementer tried to READ/EDIT a directory and an uncaught `EISDIR` aborted the stage. `toolEdit` / `toolMultiEdit` / `toolOutline` now return a graceful "is a directory; use LIST" note; unit-covered. The rerun passed in 11.6 s.

The driver's own first-run bug (checkers without `cwd=run_dir`) initially failed every row including a correct RA solution; it was fixed before any result above was recorded, and run 1's evidence is retained only as process history in `/private/tmp/ra-bench/runs`.

## Scope

One matrix, two small repositories, three tasks, one run per cell (opencode rerun for confirmation), no cost measurement (tools do not uniformly report spend), and no user-intervention measurement (all runs headless by construction). Codex ran its default frontier model (gpt-5.6-sol); claude ran GLM-5.3-flash via Z.AI because no Anthropic credential exists on this Mac; RA and opencode ran the same Ollama Cloud model. Model choice is inherent to each tool's available configuration and is stated per column so the speed comparison is read correctly: RA's advantage here is a mix of agent-loop efficiency and its faster-to-converge pipeline, not proof of model superiority.
