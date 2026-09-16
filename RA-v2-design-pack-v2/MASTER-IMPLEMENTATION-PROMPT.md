# Master implementation prompt — RA v2

You are upgrading the public repository `zarigata/RA`.

Do not rewrite working subsystems merely for stylistic reasons. Preserve current CLI compatibility, safety boundaries, sandbox behavior, role commands, MoA, swarms, session history and installed-user acceptance tests.

Read the repository first. Then implement the following in small verified phases.

## Product direction

RA becomes a local-first model operating system for coding.

Local AI servers perform most routine work:
- repository exploration;
- summaries;
- retrieval;
- test-log analysis;
- planning;
- routine implementation;
- review;
- context compression.

Strong frontier models such as GPT or GLM are escalation specialists for difficult architecture, deadlocks, high-risk changes, unresolved expert disagreement and final arbitration.

## Required architecture

1. Temple Router
2. Model Registry / endpoint discovery
3. Seshat Context Engine
4. structured Evidence Engine
5. Ma'at verification judge
6. application-level mixture of experts
7. local-first escalation policies
8. server/task telemetry
9. context profiles
10. living Egyptian TUI

## Context requirements

Never solve long context only by replaying or compacting the full transcript.

Persist full history, but construct a targeted active context packet for each call:
- system/project rules;
- objective;
- acceptance criteria;
- current diff/touched files;
- retrieved symbols/tests;
- project/session memory;
- structured evidence.

Store huge tool outputs as content-addressed artifacts and inject summaries/references unless full content is required.

## Provider requirements

Keep Ollama support and add a generic OpenAI-compatible endpoint abstraction suitable for llama.cpp, vLLM, SGLang, LM Studio or custom inference servers.

A server record should be able to express:
- model;
- context/output limits;
- tools;
- structured output;
- vision;
- reasoning support;
- local/LAN/cloud classification;
- concurrency;
- latency;
- tokens/sec;
- queue/load;
- monetary cost.

## Routing requirements

Prefer in order:
1. deterministic tool;
2. small local model;
3. strong local model;
4. alternate local specialist;
5. frontier model.

Escalation must have a concrete reason recorded in task history.

Do not trust self-reported model confidence as the primary signal. Prefer test failures, compilation failures, repeated repair loops, invalid tool calls, expert disagreement, risk classification or explicit user request.

## Verification requirements

Only deterministic evidence or explicit human approval can mark a high-confidence task complete.

## TUI requirements

Build a responsive Egyptian living scene tied to local PC time.

Periods:
- dawn 05:00–07:29;
- day 07:30–16:59;
- sunset 17:00–19:29;
- night 19:30–04:59.

Scene:
- pyramids;
- Nile;
- sun/moon movement;
- stars;
- birds;
- torches;
- subtle sand/river animation.

Runtime symbolism:
- scarab = worker/tool active;
- Nile pulse = token stream;
- torch = local model active;
- illuminated obelisk = frontier/cloud call;
- scales = review;
- balanced scales = verification passed;
- papyrus roll = context compaction/summarization;
- eclipse = critical error.

Animations must be low-overhead, non-blocking, skippable, responsive, SSH-safe and support reduced-motion/off.

Add commands:
`/scene auto|dawn|day|sunset|night|minimal`
`/motion full|reduced|off`

Use mocked clocks and snapshot tests.

## Execution discipline

For each phase:
1. inspect existing implementation;
2. write a small design note;
3. change the minimum set of files;
4. run relevant current tests;
5. add tests for the new behavior;
6. fix regressions before continuing;
7. update changelog/status documentation.

Do not claim success unless tests actually ran.

At the end produce:
- changed-file list;
- architecture summary;
- migration/config examples;
- benchmark comparison;
- token/cloud-call comparison where measurable;
- unresolved risks.
