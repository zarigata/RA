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

## D-013 — Subagents are Markdown agents spawned via a `TASK` tool (2026-08-22)

- **Context:** Need spawnable subagents (General, Explore, Scout) for opencode parity. The agent loop already supports arbitrary roles via `runTaskAgent` and Markdown agent files.
- **Options:** A separate subagent runtime; reuse `runTaskAgent` with new agent files.
- **Choice:** Add `general.md`, `explore.md`, `scout.md` agent definitions (with `permission` frontmatter: explore/scout read-only) and a `TASK <role> <task>` tool in `execToolBlock` that recursively calls `runTaskAgent`. The spawn function is injectable for testability.
- **Why:** Reuses the existing agent execution path (model routing, permissions, tool loop) rather than building a parallel runtime. Explore/Scout are read-only by frontmatter, matching their recon/search purpose. The TUI subagent *tree* is deferred — the spawn mechanism is the core parity gap; visualization is polish.

## D-012 — Fallback chain extracted to `runWithFallback` in `ollama.ts` (2026-08-22)

- **Context:** The model router fallback (cloud→LAN→local) was implemented inline in `runner.ts` with a duplicated try/catch loop. The roadmap flagged it as "no chain" because the logic wasn't reusable or tested.
- **Options:** Leave inline; extract to a helper.
- **Choice:** Extract `fallbackChain(configured)` (ordered candidate list) and `runWithFallback(configured, env, run, pick?)` (iterates candidates, records per-attempt host/latency, returns first success) into `ollama.ts`. Refactor `runner.ts` to call it. The `pick` function is injectable for testability.
- **Why:** The fallback logic is a core model-layer concern that belongs next to `pickClientForModel`, not buried in the pipeline runner. Extracting it makes it unit-testable (no live network) and removes ~25 lines of duplicated try/catch. Behavior is preserved: cloud→LAN→local for BIG, LAN→local→cloud for small.

## D-011 — Custom slash commands live in `.anubis/commands/*.md` (2026-08-22)

- **Context:** Need user-defined slash commands (opencode parity). Existing commands are hardcoded in a switch.
- **Options:** JSON config; Markdown files; a plugin API.
- **Choice:** Markdown files in `.anubis/commands/` with `name`/`description`/`prompt` frontmatter. Unknown slash commands fall through to these before the "Unknown" error.
- **Why:** Matches the existing agent/skill convention (Markdown + frontmatter already used for `.anubis/agents/*.md`). A custom command is just a prompt template run through the `anubis` agent, so no new execution model is needed. Keeps the hardcoded switch as the fast path.

## D-010 — Agent frontmatter `permission` overrides config `permission.tool` (2026-08-22)

- **Context:** Agent Markdown files (e.g. `thoth.md`) already declare a `permission` block (`edit: deny`, `bash: deny`), but it was stripped by `loadAgentPrompt` and never enforced. Config-level `permission.tool` was added in D-009.
- **Options:** Ignore frontmatter; enforce frontmatter only; enforce both with precedence.
- **Choice:** Parse frontmatter `permission` and enforce it in `execToolBlock` *before* config rules. A tool is blocked if either the agent frontmatter or the config denies it.
- **Why:** Agent-level permissions are the more specific, role-intrinsic constraint (thoth is read-only by design), so they take precedence. Config `permission.tool` remains a global override. Both are deny-by-default for `ask`/`deny`.

## D-009 — Permission engine: `ask` treated as deny in headless mode (2026-08-22)

- **Context:** Need per-tool allow/ask/deny rules. The agent loop is currently headless (no interactive approval prompt).
- **Options:** Implement full interactive approval; treat `ask` as deny for now.
- **Choice:** Enforce `allow` (proceed) and `deny`/`ask` (block) in `execToolBlock`. `ask` is treated as deny until an interactive approval flow exists.
- **Why:** Blocking on `ask` is the safe default — it never performs an action the user hasn't approved. Interactive approval is deferred to the client/server split (D-008) where a real prompt loop can live. This is a strict, non-stub enforcement: a denied tool returns an error note to the model rather than silently no-oping.

## D-008 — Project memory: `AGENTS.md` preferred over `RA.md` (2026-08-22)

- **Context:** Need project conventions auto-loaded into the agent's context (opencode parity). Two candidate filenames exist in the ecosystem: `AGENTS.md` (opencode convention) and `RA.md` (RA-specific).
- **Options:** Only `AGENTS.md`; only `RA.md`; both with precedence.
- **Choice:** Check `AGENTS.md` first, then `RA.md`; inject the first non-empty one into the system prompt.
- **Why:** `AGENTS.md` is the established opencode convention (parity target), so it wins. `RA.md` is a fallback for RA-native projects. Both are read from the project cwd, not the repo root, so per-directory conventions apply.

## D-007 — Sessions persist per-project to `~/.ra/sessions` (2026-08-22)

- **Context:** Need multi-session support (list/switch/kill) without a daemon yet. Sessions already persist to disk keyed by project cwd.
- **Options:** In-memory only; per-project JSON files; a central daemon.
- **Choice:** Keep per-project JSON files under `~/.ra/sessions` (existing `sessionPath`), and add `listSessions`/`deleteSession`/`formatSessions` to enumerate and kill them. `switch` is deferred until the daemon (D-008) lands.
- **Why:** The persistence layer already exists and is tested; adding list/kill is a small, safe increment. A full daemon (client/server split) is a larger P1 task that will subsume session management.

## D-006 — Env-var model overrides use `RA_*` > `ANUBIS_*` precedence (2026-08-22)

- **Context:** `ra.json` already loads, but `.env.example` declared `ANUBIS_MODEL=` with no code wiring it. Need env-var overrides for the BIG/small model without editing config files.
- **Options:** Only `ANUBIS_*`; only `RA_*`; both with precedence.
- **Choice:** Support both `RA_MODEL`/`RA_SMALL_MODEL` and `ANUBIS_MODEL`/`ANUBIS_SMALL_MODEL`, with `RA_*` winning when both are set. Applied after project override, before use, in `runner.ts` and `tui/app.ts`.
- **Why:** `ANUBIS_*` is the legacy name already in `.env.example`; `RA_*` is the current product name. Supporting both is backward-compatible, and `RA_*` precedence reflects the rebrand. Env overrides sit above config but below the `--model` CLI flag (which is handled separately in the router).

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
