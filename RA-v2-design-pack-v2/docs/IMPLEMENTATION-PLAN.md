# RA v2 — Implementation Plan

## Phase 0 — Freeze current behavior
- run current unit tests and installed-user acceptance suite;
- record baseline;
- do not rewrite the whole agent at once.

## Phase 1 — Model Registry
- introduce normalized provider/model/server records;
- preserve current Ollama behavior through adapter;
- add OpenAI-compatible endpoint adapter;
- add health probes and capability overrides;
- expose `ra temple list`, `ra temple doctor`.

Acceptance:
- existing model selection continues to work;
- at least two endpoints can be configured simultaneously;
- each endpoint reports capabilities and health.

## Phase 2 — Seshat Context Engine
- separate persisted transcript from active prompt;
- add context packets;
- add content-hash tool artifact store;
- add repository/symbol retrieval;
- add per-call token budget.

Acceptance:
- full transcript remains available;
- agent calls no longer require full transcript replay;
- large test output is stored and represented by compact evidence.

## Phase 3 — Temple Router
- implement local-first policy;
- route task categories;
- add server-load telemetry;
- add explicit escalation reasons;
- add per-task cloud-call budget.

Acceptance:
- routine test-analysis can be delegated to a small local model;
- strong local model handles implementation;
- frontier model is not called unless policy permits.

## Phase 4 — Evidence + Ma'at
- normalize test/lint/compiler results;
- judge completion from deterministic evidence;
- add repair loop limits;
- add disagreement escalation.

Acceptance:
- “model says done” cannot mark a task verified;
- passing configured checks can.

## Phase 5 — Multi-expert council
- expert fan-out;
- task-specific role selection;
- parallel local workers;
- evidence-aware synthesis.

Acceptance:
- multiple experts can operate without all receiving full session history;
- final synthesis gets only relevant outputs/evidence.

## Phase 6 — Living Egyptian TUI
- responsive scene renderer;
- local-time scene state;
- animation scheduler;
- runtime-state glyphs;
- reduced-motion/no-color modes;
- snapshot tests at several terminal sizes.

Acceptance:
- dawn/day/sunset/night render correctly from mocked clock;
- animation never blocks input/model streaming;
- SSH/narrow terminals get compact UI.

## Phase 7 — Outcome learning
- store task/result telemetry locally;
- rank model/server combinations by task type;
- never silently alter security/privacy boundaries.

## Phase 8 — README + demo
- replace README landing section;
- include architecture diagram;
- record GIF/video separately if desired;
- document local-first cluster setup;
- document cost/context telemetry.

## Non-negotiables
- no automatic cloud upload of raw repo data;
- no claim that agent-level MoE equals neural MoE;
- no giant-context stuffing by default;
- no completion based only on model confidence;
- every cloud escalation visible and attributable;
- preserve current sandbox restrictions.
