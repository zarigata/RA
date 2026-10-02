# Local controller, remote coder

Use `routing.mode: "local-controller"` to pin every role except `ptah` to `small_model`. This policy wins over frontmatter pins, capability routing, and continuation overrides. Controller fallbacks exclude cloud IDs. `ptah` remains the coding lane; choose its provider/model explicitly. A local model failure stops the controller rather than uploading its work.

Generate a starting configuration (merge into your existing configuration, preserving provider definitions, permissions, MCP and other settings):

```sh
node scripts/local-controller-config.ts 8 openrouter/YOUR_MODEL
```

The number is **available**, not total, VRAM in GB. The script prints the Ollama pull command; it does not download anything. Starting presets are Qwen3 4B for 4 GB, 8B for 8 GB and 14B for 12 GB, with 4096-token local caps. Below 4 GB it selects 1.7B. These are conservative candidates, not measured benchmarks. Ollama's published weight sizes are 2.5 GB, 5.2 GB and 9.3 GB respectively: https://ollama.com/library/qwen3 . Context cache, driver overhead and concurrent models need extra memory. No GPU detection or install automation is implemented here.

Cloud models use existing configured providers. Choose an actual model offered by your account; the script's provider/model argument is not a model catalog. OpenRouter, Z.AI and OpenAI-compatible endpoints use existing provider configuration. This change does not add a native Anthropic Messages API adapter.

## Compact project knowledge

Create `.ra/memory-cards.json` inside the project:

```json
[
  {"id":"acceptance", "required":true, "summary":"Completion requires the build and integration tests to pass."},
  {"id":"payments", "tags":["billing","stripe"], "summary":"Billing connector: src/billing.ts; webhook verifies signatures and updates subscriptions idempotently."}
]
```

RA includes required cards and cards whose tags match task words. Whole cards fit into a 6000-character packet; required cards that cannot fit fail explicitly. Cards persist on disk across restarts. Store interface contracts, file pointers, decisions and acceptance criteria. Do not store secrets or private reasoning: selected cards are sent to the coding provider. Existing project instructions and tool interfaces still accompany requests. This bounds the additional memory packet, not the entire prompt.

## What this establishes, and what remains

This adds routing boundaries, provider-aware budget detection, task-relevant persistent knowledge and VRAM starting presets. Existing checkpoint/resume behavior remains in place. It does **not** yet implement automatic memory extraction, connector introspection, GPU probing, cloud catalog selection, or a durable autonomous task queue. A local review role is not proof that a project is complete: a future completion gate must require recorded test results, acceptance checks and an explicit fail/uncertain/pass verdict before reporting completion. Do not rely on model approval alone.
