# Changelog

All notable user-facing changes to RA, grouped by version.

## [Unreleased]

### Added
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
