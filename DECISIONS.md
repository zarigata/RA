# Decisions

Architecture decision records: context, options, choice, why.

## D-001 — Fork opencode as the base (2026-08-12)

- **Context:** Need a terminal AI coding agent with per-agent model routing, plugin system, 75+ providers, parallel subagent execution, single-binary install.
- **Options:** opencode (MIT), aider (Apache-2.0), goose (Apache-2.0).
- **Choice:** Fork opencode.
- **Why:** Only opencode natively satisfies MOA + plugin + multi-provider + parallel-execution requirements. MIT license permits the fork.

## D-002 — Two-package layout: `anubis/` engine + `ra/` runtime (2026-08-22)

- **Context:** The project has two TypeScript packages: `anubis/` (engine: router, aggregator, pipeline, cost, LAN, intent, TUI primitives) and `ra/` (runtime: CLI, TUI app, agent loop, tools, benchmark, doctor).
- **Options:** Single package; two packages.
- **Choice:** Keep the existing two-package split.
- **Why:** `anubis/` is the reusable engine (also ships an `anubis` binary); `ra/` is the RA-branded runtime that imports from it. `ra/src/cli.ts` is the entrypoint for both `ra` and `anubis` binaries. Preserving this split avoids a risky merge and matches the existing architecture.

## D-003 — Model routing: small@LAN → BIG@cloud, gemma@local fallback (2026-08-22)

- **Context:** "mac-weak" profile: small models on a LAN box (192.168.1.251 qwen3.8), BIG models on Ollama Cloud (glm-5.2), localhost gemma as fallback.
- **Options:** All-cloud; all-local; hybrid routing.
- **Choice:** Hybrid: route plan/meta to small@251, code to BIG@cloud, fall back to localhost gemma when .251 is down.
- **Why:** Cost principle — local/LAN are free; reserve cloud tokens for heavy implementation. Matches the documented "RA prefer small@251 → big@cloud" invariant enforced by the test gate.

## D-005 — `ra run` reuses `runFullDevTask` with `quiet: true` (2026-08-22)

- **Context:** Need a headless, non-interactive mode for CI/scripting. `ra --task` already runs the pipeline but always prints the TUI splash and stage boxes.
- **Options:** New separate runner; reuse `runFullDevTask` with a `quiet` flag.
- **Choice:** Reuse `runFullDevTask` with `quiet: true`, then print only the machine-readable result lines (`RA RESULT`, `RA lane`, `RA intent`, `RA prefer`) and optional `--json`/`--verify`.
- **Why:** `runFullDevTask` already handles model routing, fallback, file writing, and last-run persistence. A `quiet` flag avoids duplicating that logic and keeps the public CLI surface stable. The `quiet` option already existed in the signature but was unused by the CLI.

## D-004 — Initialize git + six state files (2026-08-22)

- **Context:** The repo was not a git repository and had no ROADMAP/STATUS/CHANGELOG/DECISIONS/BUGS/BLOCKED files.
- **Options:** Work without version control; initialize git.
- **Choice:** Initialize git and create the six state files.
- **Why:** The autonomous build directive requires persistent memory across cycles and atomic conventional commits. `.env` is already gitignored; verified no secrets are staged.
