# RA v2 — Architecture Proposal

## 1. Core goal

Turn RA from a multi-agent coding client into a local-first model orchestration runtime.

The system must optimize four things simultaneously:

1. correctness;
2. context efficiency;
3. local compute utilization;
4. minimum unnecessary frontier-model usage.

## 2. New subsystems

### Temple Router
Central scheduling and escalation layer.

Responsibilities:
- discover inference endpoints;
- maintain health/latency/load telemetry;
- classify tasks;
- select model + server + context profile;
- enforce budgets;
- perform retry and escalation decisions;
- track verified outcomes.

Suggested modules:
- `router/capabilities`
- `router/policy`
- `router/scheduler`
- `router/escalation`
- `router/history`

### Seshat Context Engine
Separate persistence from active prompt context.

Responsibilities:
- repository map;
- symbol index;
- lexical and semantic retrieval;
- session/project memory;
- change-aware summaries;
- content-hash cache;
- tool output virtualization;
- context packet assembly;
- context token budgeting.

### Evidence Engine
Turns tool results into structured evidence.

Evidence types:
- test result;
- compiler diagnostic;
- lint diagnostic;
- Git diff;
- static-analysis finding;
- benchmark result;
- screenshot/visual result;
- security finding.

Every evidence item should include source, timestamp, affected files, severity and artifact reference.

### Ma'at Judge
A review role that consumes structured evidence rather than raw agent prose.

The judge can return:
- `verified`;
- `needs_repair`;
- `needs_human`;
- `escalate`.

### Model Registry
Use canonical IDs independent of provider.

Example:
`qwen-coder-local` can resolve to a concrete endpoint/model combination.

Store:
- capabilities;
- context/output limits;
- local/cloud classification;
- measured throughput;
- task success statistics;
- cost metadata;
- concurrency.

## 3. Context algorithm

For each call:

1. establish objective and acceptance criteria;
2. include only current project rules relevant to the task;
3. add touched files/diff;
4. retrieve relevant symbols/tests;
5. attach compact session/project memory;
6. reserve output and tool-call budget;
7. trim lowest-value retrieval;
8. call model;
9. store complete response/history locally;
10. extract decisions into memory as deltas.

Do not use compaction as the only long-session strategy.

## 4. Local-first policy

Default priority:
1. deterministic non-AI tool;
2. small local model;
3. strong local model;
4. another local specialist;
5. frontier model.

A frontier call must record an escalation reason.

## 5. Provider abstraction

Support:
- Ollama native API;
- OpenAI-compatible APIs;
- future custom adapters.

RA should probe endpoints where possible and allow manual overrides where probing is impossible.

## 6. Reliability

Model statements never count as verification.

Only deterministic checks or explicit human approval can mark high-confidence completion.

## 7. Privacy

Each provider/model receives a classification:
- `local`;
- `lan`;
- `trusted-cloud`;
- `cloud`.

Policy can forbid particular files or secret classes from crossing each boundary.

## 8. Metrics

Track:
- local/cloud tokens;
- local/cloud calls;
- estimated cost avoided;
- time-to-first-token;
- tokens/sec;
- repair loops;
- test pass rate;
- context size;
- cache hit rate;
- model success by task type.
