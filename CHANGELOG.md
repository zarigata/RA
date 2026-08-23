# Changelog

All notable user-facing changes to RA, grouped by version.

## [Unreleased]

### Added
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
