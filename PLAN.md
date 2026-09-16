# RA — Implementation Plan

This is the active roadmap for RA. It replaces the old historical competitor matrix with work that can be implemented, tested, and accepted.

The north star is straightforward:

> **RA should use local intelligence for volume, specialist intelligence for leverage, and verification for trust.**

The deeper design is documented in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Rules for this plan

Every phase follows the same rules:

- Do not advertise roadmap work as shipped.
- Prefer measurable behavior over feature-count claims.
- Keep headless CLI behavior working while improving the TUI.
- Keep provider credentials out of source and test fixtures.
- Local/offline CI must not require a paid model call.
- Any model-generated success claim is weaker than an independently executed test.
- New autonomous capabilities need an explicit permission/trust boundary.
- Features that increase context size must justify their token cost.

---

# Phase 0 — Release Hygiene and Repository Truth

**Priority:** NOW

**Goal:** one clean command proves that the checkout is fit to merge.

## 0.1 Documentation reset

- [x] Rewrite root README around the current product rather than accumulated release notes.
- [x] Separate shipped, limited, and planned features.
- [x] Document the actual `ra/src/cli.ts` entrypoint and compatibility launcher.
- [x] Add a maintained architecture document.
- [x] Replace the historical master plan with this executable roadmap.

## 0.2 Offline release gate

Add `scripts/verify-release.sh` as the canonical local/CI command.

It must:

- [ ] install Bun dependencies from the committed lockfile;
- [ ] run the curated offline unit suite;
- [ ] run source CLI smoke checks;
- [ ] compile `ra/src/cli.ts` to a temporary standalone executable;
- [ ] smoke-test the compiled executable;
- [ ] verify the existing install launcher in a temporary HOME/bin;
- [ ] reject tracked dependency trees, caches, secrets, logs, and build output;
- [ ] leave no generated release artifact in the repository.

## 0.3 CI

- [ ] Make GitHub Actions call the same `scripts/verify-release.sh` developers use locally.
- [ ] Keep live Ollama/LAN tests outside mandatory hosted CI.
- [ ] Add a reasonable timeout so dead tests fail instead of consuming a runner forever.

## 0.4 Ignore policy

- [ ] Expand `.gitignore` for build output, coverage, Python caches, TypeScript build metadata, editor files, and temporary files.
- [ ] Do not delete source/reference material merely because it is large or old; deletion requires an explicit ownership decision.

### Phase 0 acceptance

```bash
bash scripts/verify-release.sh
```

must exit `0` from a clean checkout, and `git status --porcelain` must remain empty afterward.

---

# Phase 1 — Local AI Mesh

**Goal:** make several local/LAN/cloud endpoints behave like one measured capability pool.

## 1.1 Endpoint registry

Introduce a normalized provider endpoint record containing:

```text
id
kind                  local | lan | cloud
engine                ollama | lmstudio | openai-compatible | native-provider
base_url
models[]
health
last_seen
latency
quota/cooldown state
```

Requirements:

- [ ] discover configured endpoints without requiring every endpoint to be online;
- [ ] preserve explicit user configuration over discovery;
- [ ] never print secrets in `ra providers`, logs, or JSON exports;
- [ ] make unavailable endpoints visible instead of silently deleting them.

## 1.2 Model capability profiles

Store/probe useful execution metadata:

- [ ] context window;
- [ ] modalities;
- [ ] code/reasoning/review/research suitability;
- [ ] measured latency and throughput;
- [ ] local/cloud cost class;
- [ ] warm/cold state when available;
- [ ] recent failures and cooldown.

Start with static provider metadata plus local benchmark observations. Do not pretend benchmark scores are universal model quality scores.

## 1.3 Router scoring

Given a task, rank eligible models using:

```text
capability fit
+ routing-mode preference
+ locality bonus
+ health
+ latency
+ budget
- recent failures
- quota exhaustion
```

The route must be explainable through CLI/TUI telemetry.

## 1.4 Pre-warming

- [ ] optional warm policy for frequently used local models;
- [ ] never hold every model in VRAM by default;
- [ ] support a low-memory policy for 16–24 GB GPUs;
- [ ] expose what is currently warm/loaded when the backend can report it.

### Phase 1 acceptance

A test configuration with two fake local endpoints and one fake cloud endpoint must prove deterministic routing, fallback, cooldown, redaction, and budget behavior without internet access.

---

# Phase 2 — Context and Token Economy

**Goal:** make RA good at large projects without treating the whole context window as a dumping ground.

## 2.1 Repository map

Build a cached project map containing:

- [ ] tracked file tree;
- [ ] language detection;
- [ ] important manifests/configuration;
- [ ] symbol/import relationships where supported;
- [ ] Git recency/change signals;
- [ ] test/source pairing hints.

Cache by repository state/content hash and invalidate incrementally.

## 2.2 Retrieval

Combine cheap lexical search with optional semantic retrieval:

- [ ] exact identifier/path search first;
- [ ] embeddings/semantic search when useful;
- [ ] rank by task relevance, file importance, and change proximity;
- [ ] return citations/paths so the agent can request more context deliberately.

Do not embed secrets or ignored files by default.

## 2.3 Context packer

Add an explicit context budget with buckets for:

```text
system + permissions
project rules
selected repository context
conversation/memory
agent instructions
reserved tool/answer budget
```

- [ ] show context usage in status/debug output;
- [ ] deduplicate repeated tool content;
- [ ] replace large previous outputs with referenced artifacts/summaries;
- [ ] compact old conversation with a small/local model where possible;
- [ ] preserve recent user intent and unresolved tasks verbatim.

## 2.4 Context regression tests

Fixtures should verify that:

- [ ] relevant files are selected;
- [ ] unrelated large files are excluded;
- [ ] repeated turns do not grow context without bound;
- [ ] compaction preserves named requirements and file references.

### Phase 2 acceptance

On a fixed medium-size fixture repository, RA must produce a deterministic context manifest showing what was included and why, while staying below a configured budget.

---

# Phase 3 — Agent, Skill, Tool, and Plugin Search

**Goal:** let RA grow to hundreds of capabilities without loading hundreds of instructions into every prompt.

## 3.1 Unified capability manifest

Normalize metadata for:

- agents;
- skills;
- custom commands;
- MCP tools;
- approved plugins.

Suggested common fields:

```text
id
kind
name
description
tags
languages/frameworks
permissions
cost class
source/trust metadata
```

## 3.2 Capability index

- [ ] lexical index available with zero external model;
- [ ] optional embedding index generated locally;
- [ ] incremental updates when capability files change;
- [ ] rank results using task intent + repo signals.

## 3.3 Search UX

Planned surfaces:

```bash
ra search "postgres migration reviewer"
ra agents --search "typescript security"
```

And one unified TUI palette section showing the best agents/skills/tools for the current task.

## 3.4 Progressive disclosure

Only the compact manifests of likely capabilities belong in routing context. Full agent/skill/plugin instructions are loaded **after selection**.

### Phase 3 acceptance

A fixture containing at least 100 capability manifests must show that a targeted query finds the relevant specialist while prompt metadata stays bounded to Top-K results.

---

# Phase 4 — Plugin Hardening and Capability Packs

**Goal:** borrow the strongest open-source coding-agent ideas without turning RA into an unsafe pile of plugins.

The prior design work identified **Caveman**, **Ponytail**, agent-search tooling, and related projects/patterns as research candidates. They are not treated as current RA dependencies.

## 4.1 Research track

For each candidate:

- [ ] document upstream repository and license;
- [ ] identify the concrete behavior worth adopting;
- [ ] determine whether an adapter, reimplementation, or no integration is appropriate;
- [ ] record security implications;
- [ ] add reproducible acceptance tests before enabling it by default.

## 4.2 Plugin manifest

A plugin must declare requested capabilities before activation:

- [ ] filesystem scope;
- [ ] network access;
- [ ] command execution;
- [ ] requested secret/provider access;
- [ ] MCP/tools exposed;
- [ ] version/source information.

## 4.3 Trust policy

- [ ] default-deny privileged capabilities;
- [ ] project plugins cannot silently override user security policy;
- [ ] permissions are visible in the TUI/CLI;
- [ ] disabling a plugin removes its tools from model context immediately;
- [ ] plugin failures cannot corrupt the main session state.

## 4.4 Useful behavior to internalize

Focus research on patterns that improve code quality:

- evidence gathering before editing;
- persistent task plans/state;
- independent reviewers;
- deterministic verification loops;
- scoped specialist prompts;
- better repository search;
- explicit completion criteria.

### Phase 4 acceptance

A deliberately over-privileged test plugin must be denied or require explicit policy, while a read-only capability pack loads and unloads without changing unrelated agent behavior.

---

# Phase 5 — Egyptian TUI Renaissance

**Goal:** make RA visually unmistakable while keeping it fast, readable, and scriptable.

## 5.1 Time-aware ambient scene

Use the host's local clock to choose deterministic scene state:

```text
05:00–08:00  dawn
08:00–17:00  day
17:00–20:00  sunset
20:00–05:00  night
```

Exact ranges should be configurable.

Scene vocabulary:

- pyramids/desert horizon;
- Eye of Ra / Eye of Horus accents;
- moving sun and moon;
- stars at night;
- torch/activity glyphs;
- subtle hieroglyph transitions.

## 5.2 Animation architecture

- [ ] renderer clock is separate from agent/model execution;
- [ ] scene frames are pure functions of dimensions + timestamp + animation tick;
- [ ] no animation in `--json`, piped output, or CI;
- [ ] respect reduced-motion mode;
- [ ] cap redraw rate;
- [ ] pause animation while terminal is not visible where detectable.

## 5.3 Work-focused layout

The art frames the application; it does not consume the workspace.

Keep priority on:

- conversation/code readability;
- agent tree;
- context/cost/model lane;
- test/build state;
- Git change state;
- fuzzy command/capability search.

## 5.4 Snapshot tests

Inject a timestamp and terminal size so dawn/day/sunset/night frames are testable without depending on the runner's actual clock.

### Phase 5 acceptance

PTY tests render all four periods at small and large terminal sizes with no broken escape sequences, and headless commands remain byte-stable.

---

# Phase 6 — Multi-GPU / Multi-Node Orchestration

**Goal:** scale from one local endpoint to an AI rack without changing how the developer asks for work.

## 6.1 Node registry

Track each AI server's:

- endpoint/engine;
- available models;
- GPU/VRAM metadata when exposed;
- active load;
- health/latency;
- network locality.

## 6.2 Scheduler

Prefer nodes based on model availability and task fit, then load/cost/latency.

Do not assume tensor-parallel inference across arbitrary machines. Treat each endpoint as an independent worker unless the backend itself provides distributed inference.

## 6.3 Agent placement

Examples:

```text
fast local GPU     → search / summaries / quick agents
large local GPU    → implementation / long-context work
secondary GPU      → critics / vision / embeddings
cloud SOTA         → escalation / final hard synthesis
```

## 6.4 Failure handling

- [ ] node loss does not lose session state;
- [ ] retries preserve idempotency for tool calls;
- [ ] in-flight edits are checkpointed before expensive transitions;
- [ ] router records why it moved work.

### Phase 6 acceptance

A simulated three-node pool must survive one endpoint disappearing mid-run and reroute eligible model work without repeating committed filesystem effects.

---

# Phase 7 — Public Release Discipline

**Goal:** turn features into a release people can install and trust.

## 7.1 Acceptance matrix

For each release, publish evidence for:

- [ ] Linux CLI/test support;
- [ ] macOS CLI/test support;
- [ ] TUI PTY behavior;
- [ ] offline unit suite;
- [ ] compiled executable smoke test;
- [ ] provider routing fixture suite;
- [ ] at least one opt-in live local model acceptance run;
- [ ] sandbox limitations by platform;
- [ ] upgrade/install path.

## 7.2 Documentation

Keep these authoritative and small enough to maintain:

- `README.md` — what RA is and how to start;
- `docs/ARCHITECTURE.md` — design boundaries;
- `PLAN.md` — what comes next;
- provider/agent/safety docs — focused reference material.

Historical audits and obsolete design packs should be archived outside the active docs path rather than left to contradict the current product.

## 7.3 Versioning

Before tagging:

```bash
bash scripts/verify-release.sh
git status --porcelain
```

Then create the tag/release from the exact verified commit.

---

# Definition of Done for Any RA Feature

A feature is not done because an agent wrote the code. It is done when:

1. implementation exists behind the intended interface;
2. permissions/trust implications are explicit;
3. offline tests cover the core behavior;
4. failure/cancellation behavior is tested;
5. docs say what is actually shipped;
6. the release gate stays green;
7. the feature does not leave generated junk in the repository;
8. model/provider claims are measured or clearly labeled as configuration-dependent.

# Immediate execution order

The next engineering work should happen in this order:

```text
0. Finish release gate + clean CI
1. Endpoint registry / capability profiler
2. Context packer + repo retrieval
3. Unified agent/skill/plugin search
4. Plugin capability/trust layer
5. Time-aware Egyptian TUI
6. Multi-node scheduler
7. Public release acceptance
```

That ordering is intentional: **make RA reproducible first, cheaper/smarter second, extensible third, prettier fourth, and distributed only after the single-node architecture is measurable.**
