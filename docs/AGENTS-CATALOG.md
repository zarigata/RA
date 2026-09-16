# RA Agent Catalog — 1.0.0-ra.76

Generated from `ra agents`. 76 visible agents + 3 hidden system agents.
Custom agents: `.ra/agents/<name>.md` (project) or `~/.ra/agents/<name>.md` (user) — same frontmatter.

RA agents — 76 visible (+3 hidden system)

core (8)
  anubis — RA orchestrator. Main agent. Coordinates subagents, aggregates MOA outputs, drives the build.
  horus — Fast, cheap quick tasks. Full access but limited steps. For small jobs.
  isis — External research. Read-only. Uses web search, MCP tools, and webfetch.
  maat — Diagnosis and bug hunting. Read-only. Finds bugs, root causes, and regressions.
  ptah — Implementation. Full file and bash access. Writes and edits code.
  sekhmet — Adversarial deep review. Read-only. Attacks the work to find weaknesses.
  seshat — Documentation. Writes docs, READMEs, and comments. No bash.
  thoth — Planning and reasoning. Read-only. Produces plans, architecture, and step-by-step strategies.

data (4)
  csv-wrangler — Transforms and cleans tabular data. Writes code. CSV wrangling with quoting, types, and encoding handled.
  i18n-adjuster — Adapts software for localization. Writes code. String extraction, locales, and plural/format correctness.
  json-surgeon — Surgical JSON and structured-data edits. Writes code. Format-preserving changes to config and data files.
  regex-forge — Builds and debugs regular expressions. Writes code. Patterns with test tables proving each case.

docs (6)
  api-docs — Documents APIs. Writes code. Endpoint references with parameters, errors, and working examples.
  commit-writer — Writes commit messages. Writes code. Conventional, precise messages from the actual diff.
  docs-writer — Writes project documentation. Writes code. Guides and references grounded in the actual codebase.
  pr-describer — Writes pull request descriptions. Writes code. Context, changes, testing, and risk in reviewable form.
  readme-gardener — Maintains the README and landing docs. Writes code. Accurate, current, and honest front-page documentation.
  tutorial-writer — Writes tutorials and guides. Writes code. Step-by-step learning paths with verified instructions.

domain (8)
  backend-dev — Backend specialist. Writes code. Services, data access, concurrency, and API contracts done safely.
  data-eng — Data pipeline specialist. Writes code. Ingestion, transforms, and pipelines that are reproducible and observable.
  database-eng — Database specialist. Writes code. Schema design, migrations, queries, and index strategy.
  embedded-dev — Embedded systems specialist. Writes code. Resource limits, hardware interfaces, and timing-safe patterns.
  frontend-dev — Frontend specialist. Writes code. Components, state, styling, and browser behavior with production habits.
  ml-eng — Machine learning specialist. Writes code. Training, evaluation, and model-serving code with honest metrics.
  mobile-dev — Mobile development specialist. Writes code. Platform patterns, lifecycle, and device reality.
  sre — Reliability engineering specialist. Writes code. Health checks, alerts, runbooks, and failure drills.

implement (13)
  api-implementer — Implements API endpoints and clients. Writes code. Handlers, validation, error contracts, and callers.
  bug-fixer — Fixes bugs at the root cause. Writes code. Diagnoses first, then applies the narrowest correct fix.
  cli-builder — Builds command-line interfaces. Writes code. Flags, subcommands, help text, and exit codes.
  feature-builder — Builds complete features end to end. Writes code. Plans, implements, and verifies a vertical slice.
  general — General-purpose subagent. Full tool access for delegated tasks.
  migrator — Migrates code across versions and formats. Writes code. Reversible upgrades with preservation proof.
  perf-optimizer — Optimizes performance with evidence. Writes code. Profiles first, then fixes measured bottlenecks.
  polyglot-porter — Ports code between languages or frameworks. Writes code. Idiomatic translation preserving behavior and tests.
  refactorer — Restructures code without behavior change. Writes code. Extraction, consolidation, and cleanup with verification brackets.
  scaffolder — Scaffolds new modules and projects. Writes code. Boilerplate that follows the project's conventions.
  script-writer — Writes utility and automation scripts. Writes code. Small, robust, documented scripts for repeated jobs.
  test-writer — Writes and repairs tests. Writes code. Unit, integration, and regression tests that pin real behavior.
  ui-implementer — Implements user interface work. Writes code. Components, styling, and interaction following existing patterns.

ops (8)
  changelog-writer — Writes changelogs from history. Writes code. User-facing change summaries in the project's format.
  ci-fixer — Fixes failing CI pipelines. Writes code. Reads logs, finds the real failure, repairs workflow or code.
  docker-whisperer — Builds and repairs container setups. Writes code. Dockerfiles, compose files, and image hygiene.
  env-doctor — Diagnoses environment and setup problems. Writes code. Missing vars, broken paths, and platform quirks.
  incident-scribe — Documents incidents from evidence. Writes code. Timeline, impact, cause, and action items from logs.
  release-manager — Manages releases end to end. Writes code. Version bumps, changelogs, tags, and release verification.
  sandbox-auditor — Audits sandbox and isolation config. Read-only. Escape paths, permission gaps, and fail-open risks.
  version-bumper — Bumps versions consistently. Writes code. Every place a version lives, updated and cross-checked.

planning (8)
  architect — Designs systems and features. Read-only. Architecture proposals with options, tradeoffs, and a recommendation.
  decision-scribe — Records architecture decisions. Writes code. ADRs with context, options, and consequences.
  estimator — Estimates effort and cost. Read-only. Sized estimates with confidence ranges and cost drivers.
  product-critic — Critiques product decisions. Read-only. Sharp, evidence-based challenges to the plan's assumptions.
  risk-assessor — Identifies and ranks risks. Read-only. Failure modes, likelihood, blast radius, and mitigations.
  spec-writer — Writes precise specifications. Read-only. Behavior, interfaces, and acceptance criteria an implementer can build from.
  task-breaker — Decomposes goals into tasks. Read-only. Sequenced, sized, dependency-aware work breakdown.
  ux-writer — Writes and critiques user-facing copy. Writes code. UI text, empty states, and error messages that respect users.

research (12)
  api-archaeologist — Excavates internal and external APIs. Read-only. Traces endpoints, schemas, contracts, and call chains.
  codebase-onboarding — Onboards a newcomer to the codebase. Read-only. Tour of architecture, conventions, and first tasks.
  config-auditor — Audits configuration across environments. Read-only. Finds drift, dead keys, secrets exposure, and missing defaults.
  dependency-scout — Audits dependencies and their usage. Read-only. Versions, licenses, security advisories, upgrade paths.
  docs-reader — Reads and digests documentation. Read-only. Summarizes specs, RFCs, and doc sets with citations.
  explore — Fast codebase search. Read-only. Locates files, symbols, and references.
  interface-prober — Probes module boundaries and public surfaces. Read-only. Reports exported contracts and coupling hotspots.
  log-analyst — Analyzes logs and stack traces. Read-only. Correlates errors with code paths and probable root causes.
  repo-cartographer — Maps repository architecture. Read-only. Produces a structural map of modules, layers, and data flow.
  repo-historian — Reads git history for intent. Read-only. Attributes code to commits and explains why it changed.
  scout — Parallel reconnaissance. Read-only. Gathers context across many files at once.
  test-explorer — Maps the test suite. Read-only. Coverage shape, fixtures, runners, and untested risk areas.

review (9)
  accessibility-auditor — Audits accessibility. Read-only. Keyboard traps, contrast, semantics, and screen-reader blockers.
  code-reviewer — Reviews code for correctness and quality. Read-only. Actionable findings ranked by severity with file:line.
  dependency-auditor — Audits dependencies for risk. Read-only. Unmaintained packages, duplicate functionality, and bloat.
  diff-reviewer — Reviews the current diff or changeset. Read-only. Focused review of what actually changed.
  error-auditor — Audits error handling paths. Read-only. Swallowed errors, missing rollbacks, and misleading messages.
  license-compliance — Checks license compliance. Read-only. Dependency licenses, copyleft risk, and attribution gaps.
  perf-analyst — Analyzes performance characteristics. Read-only. Complexity, allocation, and I/O findings without changes.
  security-reviewer — Security review of code and changes. Read-only. Injection, authz, secrets, and unsafe handling findings.
  style-enforcer — Enforces style and conventions. Read-only. Deviations from the project's own patterns, not generic taste.
