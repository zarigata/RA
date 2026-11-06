# Matrix 4 — Competitive Acceptance, 2026-11-06 (competitor half)

3 independent full passes (run-a/b/c) of `ra tests/competitive_acceptance.py` with
`--tools opencode,codex,claude --budget 300`. Fresh clone per cell, independent
checker, headless. `ra` column deferred to a parallel worker (runs later).

## Results

| Tool | Task | Run A | Run B | Run C | Mean s | Pass |
|---|---|---|---|---|---|---|
| opencode | micrograd-gradient | FAIL 20.4s | FAIL 12.98s | FAIL 14.5s | 16.0 | 0/3 |
| opencode | micrograd-neuron | FAIL 24.13s | FAIL 24.17s | FAIL 9.14s | 19.1 | 0/3 |
| opencode | slugify-readme | FAIL 29.05s | FAIL 14.2s | FAIL 17.19s | 20.1 | 0/3 |
| codex | micrograd-gradient | PASS 28.22s | PASS 29.81s | PASS 26.21s | 28.1 | 3/3 |
| codex | micrograd-neuron | PASS 29.95s | PASS 23.01s | PASS 27.82s | 26.9 | 3/3 |
| codex | slugify-readme | PASS 24.03s | PASS 25.12s | PASS 23.2s | 24.1 | 3/3 |
| claude | micrograd-gradient | FAIL 8.84s | FAIL 11.19s | FAIL 8.31s | 9.4 | 0/3 |
| claude | micrograd-neuron | FAIL 8.8s | FAIL 8.0s | FAIL 8.65s | 8.5 | 0/3 |
| claude | slugify-readme | FAIL 6.76s | FAIL 7.7s | FAIL 7.16s | 7.2 | 0/3 |

## Totals: codex 9/9 · opencode 0/9 · claude 0/9

## Env caveats

- **codex** `codex-cli 0.151.0`, default model (gpt-5.6-sol) — no quota/usage-limit errors
  encountered this session; all 9 cells passed. `--skip-git-repo-check -s workspace-write`.
- **claude** `2.1.312`, run via the user's stored Z.AI coding-plan credential
  (`zai-coding-plan` key in `~/.local/share/opencode/auth.json`) against the
  Anthropic-compatible endpoint `https://api.z.ai/api/anthropic`, model `glm-5.3-flash`.
  **Every cell in all 3 runs failed identically with `API Error: 400` — the Z.AI
  subscription has expired or been terminated and API access is paused (PT-BR message:
  "Sua assinatura venceu ou foi encerrada e o acesso à API está pausado").** The
  credential key itself is present and correctly wired; this is an account/plan-level
  blocker, not a harness issue. All claude cells are effectively SUBSCRIPTION-BLOCKED
  (each fails in ~7-11 s). Claude Code also warns it does not recognize `glm-5.3-flash`
  and assumes a 200k context window (cosmetic for these tasks).
- **opencode** `v2.2.2`, harness model flag `ollama-cloud/deepseek-v4-pro` (run as-is,
  same family as previous matrices) — no model-auth errors. Failure mode (all 3 runs,
  consistent with the prior matrix's 0/9): output narratives reference the **RA repo
  working directory**, not the fresh clone `run_dir` — glob/grep for `engine.py` /
  `nn.py` / `index.js` find nothing, shell permission requests are auto-rejected in
  non-interactive mode, and no `bench_*` file is ever written into the fresh clone, so
  the independent checker finds no file and fails.
- **Harness/driver notes**: pristine repos cloned fresh this session to
  `/private/tmp/ra-bench/repos/{micrograd,slugify}` (karpathy/micrograd,
  sindresorhus/slugify). Python 3.9 requires the sandbox dir to pre-exist. Evidence
  JSONs per cell live in `run-a/`, `run-b/`, `run-c/` here; full console logs at
  `/private/tmp/run-{a,b,c}-full.log`.
- Quota blocks: none (no codex usage-limit errors). `ra tests/COMPETITIVE_RESULTS.md`
  intentionally untouched — the RA-half worker merges Matrix 4.

