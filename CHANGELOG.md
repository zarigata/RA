# Changelog

All notable user-facing changes to RA, grouped by version.

## [Unreleased]

### Added
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
