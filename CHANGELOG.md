# Changelog

## 1.0.0-ra.75 — 2026-08-31

- Linux command execution: bubblewrap backend (`--ro-bind /`, workspace+scratch binds, clearenv + allowlisted setenv, optional `--unshare-net`), with an end-to-end capability probe — where user namespaces are forbidden (e.g. GitHub Actions runners), RA degrades honestly to filesystem-only isolation or, with explicit consent (`RA_ALLOW_UNSANDBOXED=1` / `sandbox.allow_unsandboxed`), runs unsandboxed; otherwise it fails closed with install instructions. macOS Seatbelt behavior unchanged.
- `.github/workflows/linux-acceptance.yml`: on every push to main, an Ubuntu container runner installs RA, runs one real Ollama Cloud coding task end-to-end (plan → implement → verify), asserts the fail-closed contract and consent execution, and drives the full-screen TUI through a real PTY (splash, welcome, `/` palette, `?` shortcuts). First runs caught and fixed three real Linux/TUI bugs: a boolean `bwrapPath` reaching `spawn`, userns-forbidden loopback setup, and double stdin key wiring that double-processed every keystroke (also fixed a lone-ESC/`?` merge via the classic 50 ms escape disambiguation timer).

## 1.0.0-ra.74 — 2026-08-31

- Startup splash: gradient ASCII "RA" logo composited over a dim tiled background; any key skips; window title set; OSC 11 background detection auto-picks a light or dark theme on first run.
- Real mouse menu system: right-click opens a context menu at the pointer (Search, Themes, Models, Agents submenus, Shortcuts, Clear screen, Cancel task, Quit); clicking the header opens the main menu; the footer theme chip opens the theme list; menu rows are clickable and wheel-navigable.
- `?` (and F1, and /shortcuts) opens a clickable shortcuts panel listing every keybind and quick action.
- First-run onboarding wizard: pick a look (live), pick a first move (build / get opinions / chat) — clickable and keyboard-driven; `/` skips straight to the palette; persisted via `~/.ra/tui.json` `onboarded`.
- Live theme preview while browsing theme rows in the palette; `enter` persists, `esc` reverts.
- Beginner tips: contextual TIP lines after turns until onboarding completes (and in simple mode). Cross-platform: the TUI path is pure ANSI with no macOS-only calls; only the command sandbox is platform-specific.
- Fixed during acceptance: splash logo truncation from surrogate-pair width math, menu box off-by-one, onboarding blocking the palette on first run. Unit suite 385/0 (23 TUI cases); installed-user UI acceptance 11/11 in one batch.

## 1.0.0-ra.73 — 2026-08-31

- Full-screen terminal UI (opencode-inspired) when `ra` runs in a real terminal: alternate-screen layout with a live header (logo, profile, small/big models, busy state), markdown-rendered conversation (headings, lists, bordered code blocks), streaming tokens with a spinner status, cost sidebar, subagent tree, bordered input box, and a clickable key-chip footer with cwd, git branch, and theme.
- Unified "/" palette — pressing `/` (or ctrl+p) searches EVERYTHING at once with fuzzy matching and match highlighting: built-in and custom commands, agents (direct `agent:<name>` delegation), project files (inserted as @references), sessions, models (per-session big/small switching, catalog from the live cloud), and themes. Keyboard (↑↓, enter, tab, esc, pgup/pgdn) and mouse (click a row to run, wheel to scroll).
- Mouse support: SGR click/drag/wheel decoding; palette rows and footer are clickable; wheel scrolls history.
- Themes: 8 palettes, `/theme` or palette-filtered picker, persisted to `~/.ra/tui.json` (`theme`, `mouse`, `scrollSpeed` customization keys).
- New zero-dependency TUI cores, unit-covered (`ra/tests/tui.test.ts`, 18 cases): fuzzy matcher, SGR mouse/key decoders with bracketed paste, markdown renderer, palette engine. Pipes keep the legacy readline UI; bare `ra` without a terminal still refuses clearly (scenario 17 contract).
- Installed-user UI acceptance: `ra tests/ui_acceptance.py` scenarios 66–73 (header/layout, fuzzy theme select, mouse theme click, mouse command click, file insert, streaming markdown, theme persistence across restart, non-TTY refusal).

## 1.0.0-ra.72 — 2026-08-30

- Add explicit user-configured model fallback chains with visible attribution. Provider failures (timeouts, 5xx, stream errors, unknown model) retry down the configured chain — per-model or default entries in `RA_CONFIG` `fallbacks`, or `RA_FALLBACK` / `RA_SMALL_FALLBACK` environment variables.
- Same-host-kind enforcement: a cloud selection never silently degrades to LAN/local; auth failures and user cancellations fail loudly without fallback. Every switch is attributed on stderr (JSON-safe), in the TUI stream, in role-command output, and in `ra last --json` per-stage records.
- Align the built-in chain with the live catalog (`gpt-oss:120b`, `glm-5.2`, `deepseek-v4-flash:0731`) and remove the old silent cloud→LAN→local degradation from `fallbackChain`.
- Reject empty-content WRITE tool calls with a retryable error instead of creating 0-byte files; return graceful directory-target errors from EDIT/MULTIEDIT/OUTLINE instead of crashing the stage with EISDIR. Both bugs were exposed by the new competitive benchmark and are unit-covered.
- Grant the sandboxed MCP stdio boundary read access to the server command's configured script/args paths, so servers living outside the project workspace load correctly.
- Repair the internal gate: the TUI palette E2E steps had been silently dead since .69 (non-TTY refusal swallowed by `>/dev/null`); they now run under an explicit `RA_FORCE_TUI=1` gate opt-in, unit suites run from the repo root for correct sandbox workspace resolution, the LAN backtests skip unless qwen3.8 is actually serving and responsive, and the `ra demo` E2E records a labeled skip when the .251 small-model box is unreachable instead of failing opaquely. Model-timeout aborts no longer masquerade as "Turn cancelled".
- Fix four unit tests broken by .71 guards (verify artifact `cwd`, project-memory fixtures, swarm worktree location, agent-commit contract); add `ra tests/fallback.test.ts` (9 cases) and `ra tests/fallback_acceptance.py` (4 installed-user scenarios). Unit suite fully green: 360/360.
- Add `ra tests/competitive_acceptance.py` and record the first fixed-budget real-repo comparison against all three named competitors in `ra tests/COMPETITIVE_RESULTS.md`: RA 3/3 and fastest per task (7–12 s summed 28 s); codex 3/3 (gpt-5.6-sol, 128 s summed, rerun after quota reset); claude 3/3 (claude harness via the user's Z.AI Anthropic-compatible endpoint on GLM, 225 s summed); opencode 0/6 across two runs with the same Ollama Cloud model as RA.

## 1.0.0-ra.71 — 2026-08-30 (regression proof)

- Rerun both installed-user suites against the sandboxed .71 build with live Ollama Cloud: coding **21/21** and teams **16/16**, each in one uninterrupted run. Native command sandboxing introduced no coding or team regression.
- Record results and evidence under `ra tests`: `evidence/regression-71/`, `evidence/agents-70/regression-71/`, and updated `RESULTS.md` / `AGENT_RESULTS.md` / `SAFETY_RESULTS.md`.

## 1.0.0-ra.71 — 2026-08-30

- Enforce agent tool whitelists and inherited TASK permissions at execution; read-only roles also constrain their shell commands and cannot start stdio MCP servers.
- Add `ra sandbox` and `/sandbox` controls. macOS commands default to workspace writes, private HOME/cache/temp directories, filtered environments, and denied network access. Unsupported and nested sandboxes fail closed.
- Route shell tools, compiler diagnostics, Python verification, stdio MCP, and trusted swarm Git through the shared command boundary. Bound deadlines and clean up descendant process groups.
- Protect credential names, Git/policy files, and the installed runtime; canonicalize file-tool paths. Deny inspection of other process metadata, including the reproduced synthetic parent-environment leak.
- Prevent launcher startup hooks from executing before environment filtering. Preserve command termination signals in JSON results.
- Add installed-user safety scenarios 38–60 and retain failures and reruns. See `ra tests/SAFETY_RESULTS.md` for measured results and scope; no full security certification is implied.

## 1.0.0-ra.70 — 2026-08-30

- Add CLI/TUI agent discovery, bounded read-only MoA teams, and coding swarms on retained Git worktrees.
- Preserve every participant outcome, synthesize successful proposals after partial failure, and expose actual models, shared call budgets, and cancellation state.
- Replace shared nesting/stack ownership with asynchronous execution scopes and explicit tree parents. Pipelines and nested/team agents share operation limits.
- Stage swarm integration in a separate worktree; preserve conflicts, reject dirty or moved targets, and require explicit apply unless `--merge` was requested.
- Add installed macOS cloud acceptance for team success, partial failures, budget exhaustion, read-only proposals, cancellation, isolated coding, and merge conflict recovery. See `ra tests/AGENT_RESULTS.md` for measured outcomes and remaining limits.

## 1.0.0-ra.69 — 2026-08-30

- Route exported cloud credentials/models consistently; support an external `RA_CONFIG`.
- Run CLI tasks through the actual file-aware agent loop. Persist failures and stop manufacturing success artifacts in live CLI/benchmark paths.
- Normalize DeepSeek XML and streamed native tool requests through the permission-checked tools; handle trailing stream events and upstream errors.
- Preserve nested Markdown fences and original checkpoint content; reject ambiguous edits and project-escaping symlinks.
- Keep planning/review tools read-only, carry recent conversation context, cancel active model requests with Escape, and recover after TUI command errors.
- Keep CLI JSON parseable alongside verification and expose actual role/model results.
- Add 21 installed-terminal acceptance scenarios and retained evidence under `ra tests`. See its report for live-provider failures and the final result; internal test-suite success is not claimed.


All notable user-facing changes to RA, grouped by version.

## [Unreleased]

### Cycle 44 — RA 2.0 Phase 0: trustworthy engine

### Added
- **Streaming** — tokens render live as models generate them (`nativeChatStream`: native Ollama NDJSON + cloud/OpenAI SSE, pure parsers unit-tested). Subagent/parallel turns stream only at the root to avoid interleaving. The TUI suppresses the duplicated final body when it already streamed. Verified live: 61 progressive reads per turn.
- **Latency hygiene** — `keep_alive` (default 30m, `OLLAMA_KEEP_ALIVE` override) on every native call; `ra warm [--model]` pre-loads the small model on `.251`; TUI fires a background warm-up on start. Kills the ~55s cold-load surprise.
- **MoA aggregation, real** — `/moa` now synthesizes role outputs through the small model and surfaces disagreements (conflicting file targets, mixed success/failure) instead of printing the raw aggregation prompt.
- **Custom commands, fixed** — loaded from project `.ra/commands/*.md` + `~/.ra/commands/*.md` (legacy repo dir still honored); `$ARGUMENTS` and `$1..$N` substitution; `agent:` frontmatter picks the executing role.
- **`/todos`** — user-visible checklist (☑/☐) with `/todos done <id>`; TODO tool gains `rm`.
- `withRetry`/`isTransientError` (one retry with backoff on timeouts/resets/5xx, wired into the agent loop), `abortActiveTurn` plumbing (Esc interrupt arrives in Phase 1), `warmOllama`, `parseOllamaStreamLine`/`parseSSEFrame`/`keepAliveMs` exports.
- 22 new unit tests (ra/tests/phase0.test.ts + anubis/tests/stream.test.ts); gate updated.

## [Cycle 43]

### Cycle 43 — audit & wiring (2026-08-25)

### Fixed
- **Security**: live `OLLAMA_API_KEY` removed from the repo and purged from all git history (was tracked in `OLLAMA.rtf` and as a fixture in `redact.test.ts`). Rotate the key at ollama.com to complete remediation.
- Frontmatter `model:` override is now applied before client resolution — per-agent model overrides actually take effect (was silently inert).
- Ctrl+C no longer kills the TUI: a SIGINT listener keeps readline open, matching the "Use /exit or Ctrl+D" message (reproduced and verified live).
- Subagent tree wired end-to-end: the TUI registers a tracker, `runTaskAgent` records root/spawn/complete events, `/tree` renders the live tree (verified live).
- Nested `bash:` permission maps in agent frontmatter (maat, sekhmet) now parse — glob pattern rules (`"git diff*": allow`) are enforced per command, with `"*"` as the default level.
- Cost display: subscription-covered Ollama Cloud models show `subscription` instead of a misleading `$0.000000`; LAN/local models remain free.

### Added
- MCP tools are now wired into the agent loop: configured servers are connected once (module-cached), their tools are advertised in the tool hint, and a new `MCP <server.tool> <json>` grammar verb executes them (permission-gated).
- `buildToolHint(allowed?, mcpTools?)` — the tool grammar now honors the frontmatter `tools:` whitelist and appends available MCP tools.
- `getMcpRuntime`/`setActiveSubagentTracker`/`getActiveSubagentTracker`/`loadAgentPermissionDetail`/`resolveBashLevel` exports; 9 new unit tests covering all of the above.

### Changed
- Legacy `anubis/anubis.json` fallback config aligned with reality: small = `qwen3.8:latest` @ .251 (was `qwen3:8b`, which isn't served), review roles moved off localhost gemma.
- 122 MB of dead `node_modules` removed (`.opencode/`, `anubis/.anubis/node_modules`); stale 2026-08-15 docs archived to `docs/archive/`; `INDEX.md` regenerated; `EVALUATION.md` added (full system audit + roadmap).
- CI `/ra` workflow documents the intentional localhost probe fallback (cloud-only job).

## [Cycle 42]

### Added
- MCP OAuth 2.1 support: `McpOAuthManager` handles PKCE flow (code verifier/challenge generation, authorization URL building, token exchange). `McpHttpServerConfig` now accepts an `oauth` field. Bearer tokens resolved from env vars or manual flow.
- Full LSP server protocol: `LspClient` class connects to language servers via JSON-RPC over stdio with Content-Length framing. `findLspServer` + `BUILTIN_LSP_SERVERS` for TypeScript, Python, Go, Rust. Supports `initialize`, `textDocument/didOpen`, `textDocument/diagnostic` (pull mode).
- Expanded plugin hook surface: 12 hooks now available (`agent.turn.start/end`, `tool.write.before/after`, `tool.edit.before/after`, `session.save`, `model.fallback`, plus existing hooks). `PluginHost.KNOWN_HOOKS` for discoverability. `registeredHooks()` method.
- Global hook registry in agent module (`onGlobalHook`/`emitGlobalHook`) for agent lifecycle events without requiring a PluginHost reference.
- TUI remote client mode: `ra --remote <URL>` connects the TUI to a running `ra daemon` over HTTP. Sessions sync bidirectionally. `RA_REMOTE` env var also supported.
- `RemoteClient` class for daemon communication (health check, load/append/list/delete sessions).
- Subagent tree: `SubagentTree` class tracks spawned subagents with parent→child relationships, status (running/done/error), and depth. `/tree` TUI command renders the tree.
- Session replay TUI command: `/replay list` shows the message timeline, `/replay N` jumps to step N, `/replay <keyword>` finds a step by content.
- `/connect [URL]` TUI command to connect to a daemon from inside the TUI.
- `createSubagentTracker()` exported from agent module for external use.
- Active session pointer: TUI checks `getActiveSession()` on startup and switches to the active session's cwd if set (via `ra sessions --switch`).
- LspClient error handling: throws descriptive error when LSP server binary is not found.
- Gate script updated to include `tree.test.ts`, `remote.test.ts`, `plugins.test.ts`.

### Added
- Eval harness expanded from 3 to 21 tasks covering Python, JavaScript, TypeScript, HTML/CSS, bug-fix, JSON, and algorithm tasks.
- Multi-session switch: `ra sessions --switch ID` switches the active session pointer (findSession, switchSession, getActiveSession added).
- Custom agent frontmatter `model` and `tools` fields now parsed and honored (model overrides config assignment, tools restricts available tools).
- Permission `ask` mode now supports `autoApprove` flag and `onAsk` callback for interactive approval (no longer hardcoded deny).
- MCP HTTP/SSE client (`McpHttpClient`) for Streamable HTTP transport — connects to MCP servers via HTTP POST with SSE streaming support.
- Keybinds support: `ra.json` `keybinds` field maps key combos (e.g. `ctrl+q`) to slash commands or actions.
- Theme support: `ra.json` `theme` field overrides the color palette shown in the TUI splash.
- `renderSplash` now accepts an optional theme override parameter.

### Fixed
- `runTaskAgent`'s fenced-block fallback now infers the output filename from the task + content (via `extractCodeFile`) instead of always writing `index.html`.

### Added
- Eval harness: `ra eval` runs real coding tasks against every configured model and reports pass rate, latency, and cost.
- IDE extension host protocol: `ra ide` serves a VS Code-compatible JSON-RPC 2.0 bridge over stdio (`ra/health`, `ra/sessions`, `ra/session`, `ra/message`, `ra/run`).
- Swarm mode: `swarm.ts` orchestrates N parallel agents on git worktrees with a merge pass.
- Session replay: `replay.ts` provides a message timeline, replay-up-to, transcript, and find-step for time-travel debugging.
- Semantic code search: a local TF-IDF vector index with cosine-similarity ranking and incremental re-index on file change.
- Diff viewer: `ra diff <file>` shows a unified diff between the latest checkpoint and the current file.
- Web dashboard: the daemon now serves a minimal HTML dashboard at `GET /` listing sessions.
- Per-session cost dashboard: `ra cost --session` shows token + USD usage broken down by session (project cwd) and model.
- Self-healing loop: `selfHeal` runs a test, diagnoses changed files on failure, attempts a fix, and retries (max 3), logging to `BUGS.md` if still failing.
- Air-gapped mode: `airgap: true` in `ra.json` (or `RA_AIRGAP=1`) forces 100% local operation — cloud models are localized to the small model and non-local webfetch is blocked.
- Diagnostics: a `DIAGNOSE <file>` tool runs the language's compiler/linter (tsc, py_compile, go vet, cargo check, node --check) and feeds errors back into the agent loop.
- models.dev catalog ingestion: `ra catalog` fetches the provider catalog (193 providers, 167 OpenAI-compatible) and converts it to `provider` config entries.
- Background daemon: `ra daemon` starts an HTTP server that owns session state (`/health`, `/sessions`, `/session` GET/POST/DELETE), so sessions survive terminal disconnects and multiple clients can share state.
- MCP tool search: `searchMcpTools` lazily connects to MCP servers and filters tool definitions by name/description.
- MCP stdio client: `mcp` config block in `ra.json` spawns MCP servers, lists their tools, and calls them (JSON-RPC handshake + `tools/list` + `tools/call`).
- Symbol outline: an `OUTLINE <file>` tool extracts functions/classes/imports for code navigation (regex-based, no native tree-sitter dependency).
- Session reattach: the TUI now shows a summary of the prior conversation when reattaching to a persisted session.
- LM Studio / llama.cpp auto-discovery: `discoverLocalOpenAI` probes local OpenAI-compatible servers (LM Studio @1234, llama.cpp @8080) as a last-resort small-model fallback.
- `@-mention` file picker: typing `@path/to/file` in the TUI inlines that file's content into the prompt.
- `multi-edit` tool (`MULTIEDIT <file>` with multiple OLD/NEW blocks) applies several edits to a file atomically.
- Pluggable provider abstraction: `provider/*` config entries (with `options.baseURL`/`options.apiKey` and `{env:VAR}` templating) now resolve to OpenAI-compatible clients, so non-Ollama providers can be wired via `ra.json`.
- Agent frontmatter `steps` and `temperature` are now honored: `steps` bounds the tool loop and `temperature` is passed to the model.
- GitHub Action: a `/ra` comment on a PR triggers the agent headless and posts the result back as a comment (`.github/workflows/ra-agent.yml`).
- Undo/checkpoint: `toolWrite`/`toolEdit` snapshot files before modifying; `ra undo` restores the latest checkpoint and `ra checkpoints` lists them.
- Subagents: `general`, `explore` (read-only search), and `scout` (read-only recon) agent definitions, plus a `TASK <role> <task>` tool for spawning them from the agent loop.
- Model router fallback chain: `fallbackChain` + `runWithFallback` in `ollama.ts` provide an ordered cloud→LAN→local fallback with per-attempt host/latency logging; `runner.ts` now uses it (replacing the inline fallback loop).
- Custom slash commands: Markdown files in `.anubis/commands/` (with `name`/`description`/`prompt` frontmatter) are now dispatched as slash commands.
- `todo` tool (`TODO add/done/list`) for the agent, persisted to `.ra/todos.json`.
- Agent-level permissions: `permission` blocks in agent Markdown frontmatter (e.g. thoth's `edit: deny`, `bash: deny`) are now enforced in the tool loop.
- Session export: `ra export [--cwd DIR] [--out FILE]` writes a sanitized (vibeguard-redacted) Markdown transcript of the current session.
- Permission engine: `permission.tool` allow/ask/deny rules in `ra.json` are now enforced in the agent tool loop (deny/ask block the tool).
- Project memory auto-load: `AGENTS.md` (or `RA.md`) in the project cwd is now injected into the agent's system prompt.
- Multi-session management: `ra sessions` (list) and `ra sessions --kill <id>` (delete), plus a `/sessions` TUI command.
- `webfetch` tool (`WEBFETCH <url>`) for the agent — http/https only, strips script/style/tags, 4KB cap, 15s timeout.

### Fixed
- `ra doctor` now reports success when the localhost gemma fallback is up even if the `.251` LAN box is down (previously returned exit 1).
- Env-var model overrides: `RA_MODEL`/`RA_SMALL_MODEL` (and `ANUBIS_MODEL`/`ANUBIS_SMALL_MODEL` fallbacks) override the BIG/small model from `ra.json`; `RA_*` wins over `ANUBIS_*`.
- `ra run "task"` headless command for CI/scripting — runs the full-dev pipeline without the TUI splash, with `--quick`, `--verify`, `--json`, and `--cwd` flags.
- Six persistent state files (ROADMAP, STATUS, CHANGELOG, DECISIONS, BUGS, BLOCKED) to drive autonomous development.
- Git repository initialized (project was previously unversioned).

## [1.0.0-ra.1] — 2026-08-22

### Added
- `ra` CLI + interactive TUI (Relic Agent branding).
- Full-dev pipeline (`ra --task`, `ra demo`, `/quick`) with thoth→ptah stages.
- Model routing: small (qwen3.8 @ .251 LAN) → BIG (glm-5.2 @ Ollama Cloud), gemma @ localhost fallback.
- Slash commands: `/quick /again /plan /code /pipeline /status /files /show /result /lane /intent /prefer /summary /timings /verify /history /clear /cost /models /lanes /roles /which /ping /env /doctor /selfcheck /home /ls`.
- Benchmark runner (`ra benchmark init|smoke|run`).
- 9 tier-1 plugins (papyrus, ponytail, moa, router, lan, cost-tracker, vibeguard, dcp, notify).
- 8 role agents (anubis, thoth, ptah, maat, sekhmet, isis, seshat, horus).
- 155 tests passing (143 anubis + 12 ra runtime).

## [1.0.0-anubis.1] — 2026-08-15

### Added
- Anubis Mixture-of-Agents engine (router, MOA aggregator, pipeline, cost tracker, LAN discovery, intent detection).
- 75+ provider documentation.
- 8 comprehensive docs (README, SETUP, PROVIDERS, ROLES, TROUBLESHOOTING, OPERATIONAL_PLAN, DEPLOYMENT_CHECKLIST, INDEX).
