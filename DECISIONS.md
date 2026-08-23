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

## D-023 — Diagnostics use the language compiler/linter, not a full LSP server (2026-08-22)

- **Context:** Need LSP integration (auto-detect language, spawn server, feed diagnostics after every edit). A full LSP client is a large effort.
- **Options:** Full LSP client; run the language's compiler/linter.
- **Choice:** A `diagnostics.ts` that maps file extensions to a check command (tsc, py_compile, go vet, cargo check, node --check), runs it, and parses the stderr into structured diagnostics, exposed as a `DIAGNOSE` tool.
- **Why:** This delivers the core value — diagnostics fed back into the agent loop after an edit — with zero new dependencies and full testability. A real LSP server (with incremental sync, hover, completion) remains a larger follow-up; this is the pragmatic "feed diagnostics after every edit" slice.

## D-022 — models.dev catalog converted to `provider` config, not a hardcoded list (2026-08-22)

- **Context:** Need "75+ provider compatibility". The docs claimed 75+ but code only wired Ollama. models.dev exposes a live catalog (193 providers, 167 OpenAI-compatible).
- **Options:** Hardcode a provider list; ingest models.dev at runtime.
- **Choice:** Add `catalog.ts` that fetches `https://models.dev/api.json` and converts each provider with an OpenAI-compatible `api` URL + `env` key into a `provider` config entry (with `{env:VAR}` templating). Expose via `ra catalog [--json]`.
- **Why:** Runtime ingestion stays current with the catalog and reuses the pluggable provider resolution (D-017) — no hardcoded list to drift. The `{env:VAR}` templating means keys are never embedded, only referenced.

## D-021 — Daemon is an HTTP server over the existing session store (2026-08-22)

- **Context:** Need a client/server split: a background daemon owns sessions/state/FS, and the TUI is a thin client. Sessions already persist to `~/.ra/sessions`.
- **Options:** A custom socket protocol; HTTP/JSON; gRPC.
- **Choice:** A `Bun.serve` HTTP server (`ra daemon`) exposing `/health`, `/sessions`, and `/session` (GET/POST/DELETE) over the existing `session.ts` store. The TUI still runs in-process for now; making it a remote client is a follow-up.
- **Why:** HTTP/JSON is the simplest, most debuggable transport and reuses the tested session persistence layer unchanged. It establishes the daemon boundary (state ownership) that the TUI can later connect to, and it's directly usable by the future web dashboard (P2).

## D-020 — MCP client is stdio-only for now; SSE/HTTP + OAuth deferred (2026-08-22)

- **Context:** Need an MCP client (stdio, SSE/HTTP, OAuth). The core value is spawning a server and calling its tools.
- **Options:** Full MCP transport matrix; stdio first.
- **Choice:** Implement a stdio JSON-RPC client (`McpClient`) with `initialize`/`tools/list`/`tools/call`, a `mcp` config block in `RaConfig`, and `loadMcpTools` to enumerate tools across configured servers. SSE/HTTP and OAuth are deferred.
- **Why:** stdio is the most common MCP transport and the highest-value slice; it's fully testable with a fixture server. SSE/HTTP/OAuth add transport/auth complexity that can be layered on later without changing the tool-call interface.

## D-019 — Symbol outline uses regex, not a native tree-sitter dependency (2026-08-22)

- **Context:** Need symbol outline + code navigation (tree-sitter or equivalent). Adding a native tree-sitter binding would introduce a build/dependency burden.
- **Options:** Native tree-sitter; regex-based outline.
- **Choice:** A regex-based `symbols.ts` that extracts functions/classes/methods/imports/consts/types/interfaces across Python, TypeScript/JS, Go, and Rust, exposed as an `OUTLINE` tool.
- **Why:** Regex covers the common cases for outline/navigation with zero native dependencies and is fully unit-testable. It's a pragmatic "equivalent" that satisfies the parity intent (symbol outline + navigation) without the tree-sitter build complexity. A real tree-sitter/LSP integration remains a larger P1 item (LSP) if deeper precision is needed.

## D-018 — LM Studio/llama.cpp discovered as OpenAI-compatible local servers (2026-08-22)

- **Context:** Need local-model auto-discovery beyond Ollama (LM Studio, llama.cpp). These expose an OpenAI-compatible `/v1` API, not Ollama's native `/api/tags` + `/api/chat`.
- **Options:** A separate client class; extend `OllamaClient` with an `openaiCompat` flag.
- **Choice:** Add `OllamaClient.fromOpenAI(baseURL)` (sets `openaiCompat: true`, `kind: "local"`) so `probe`/`nativeChat` use the OpenAI-compatible `/models` + `/chat/completions` path. `discoverLocalOpenAI` probes `LM_STUDIO_URL` (default `localhost:1234`) and `LLAMACPP_URL` (default `localhost:8080`), and `pickClientForModel` uses it as a last-resort small-model fallback.
- **Why:** Reuses the existing client and routing rather than a parallel class. The `openaiCompat` flag is the minimal change to route local OpenAI servers through the already-tested `/chat/completions` code path.

## D-017 — Provider abstraction resolves `provider/*` config, skips built-in Ollama (2026-08-22)

- **Context:** The `provider` block in `ra.json` (with `options.baseURL`/`options.apiKey` and `{env:VAR}` templating) was declared but never consumed; `pickClientForModel` hardcoded Ollama cloud/local/LAN.
- **Options:** Full provider registry; minimal resolver.
- **Choice:** Add `resolveProviderClient(configured, providers, env)` that maps a `provider/model` string to an OpenAI-compatible `OllamaClient` using the config block, with `{env:VAR}` key templating and `kind` inferred from the baseURL (localhost/LAN → local, else cloud). Built-in `ollama*` providers are skipped so the dedicated Ollama path still handles them.
- **Why:** This makes the provider layer genuinely pluggable (any OpenAI-compatible endpoint) while preserving the existing, tested Ollama routing. It's a minimal, non-breaking increment toward the "75+ providers" goal — the catalog ingestion (models.dev) remains a separate, larger task.

## D-016 — Agent frontmatter `steps`/`temperature` honored in the tool loop (2026-08-22)

- **Context:** Agent Markdown files declare `steps` and `temperature` in frontmatter, but `runTaskAgent` hardcoded `maxSteps = 6` and never passed temperature to the model.
- **Options:** Ignore frontmatter; honor it.
- **Choice:** Add `loadAgentMeta` to parse `steps`/`temperature`; use `steps` (falling back to the `maxSteps` arg) to bound the tool loop, and pass `temperature` through `nativeChat`/`chat` (Ollama `options.temperature` for local, `temperature` for OpenAI-compat cloud).
- **Why:** These are the two frontmatter fields that directly affect agent behavior and are already declared in every agent file. Honoring them makes custom agents actually configurable. `model`/`tools` frontmatter remain deferred (model is assigned via config/router, tools via `permission`).

## D-015 — GitHub Action uses `ra run` headless, not a separate agent runtime (2026-08-22)

- **Context:** Need a GitHub Action where a `/ra` comment on a PR triggers the agent. The headless `ra run` command (D-005) already exists.
- **Options:** A dedicated GitHub Action runtime; reuse `ra run`.
- **Choice:** A workflow (`ra-agent.yml`) that triggers on `issue_comment` with `/ra`, checks out the PR head, runs `ra run "<task>" --quick --json`, and posts the JSON result back as a comment via `github-script`.
- **Why:** Reuses the exact headless path already tested locally, so the Action exercises the same code as the CLI. `--json` gives a machine-readable result for the comment. The workflow is gated to PR comments only and requires `OLLAMA_API_KEY` as a repo secret (documented, not hardcoded).

## D-014 — Checkpoints snapshot per-file, batched into one checkpoint (2026-08-22)

- **Context:** Need undo/checkpoint: snapshot before each agent edit batch, restore on demand. Edits flow through `toolWrite`/`toolEdit`.
- **Options:** Full-tree snapshot; per-file snapshot; git-based.
- **Choice:** Per-file snapshot: `snapshotFile` stores the original content of each file before it is modified, accumulating into a single "latest" checkpoint (keyed by project cwd under `~/.ra/checkpoints`). `restoreLatest` reverts all files in that checkpoint and pops it.
- **Why:** Per-file snapshots are cheap (only touched files are copied) and map directly to the edit-batch model. A single accumulating checkpoint matches "snapshot before each agent edit batch" — all edits in one batch roll back together. Git-based undo was rejected because it would require committing and could interfere with the user's own git state.

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
