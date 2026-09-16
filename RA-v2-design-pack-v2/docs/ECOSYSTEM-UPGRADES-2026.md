# RA v2 — Open Agent Ecosystem Upgrade Blueprint
_Last researched: 2026-09-16_

## Objective

RA should not become a pile of hard-coded plugins.

RA should become a **local-first agent operating system** that consumes the open agent ecosystem through standards while selectively integrating the strongest ideas from leading coding-agent projects.

> **Support standards broadly. Load capabilities narrowly. Route work intelligently. Verify deterministically.**

## 1. Core compatibility layer — highest priority

### Agent Skills / SKILL.md
Implement Agent Skills as a first-class primitive. Index lightweight metadata at startup; load the full skill, scripts, references and assets only when needed.

Suggested CLI:

```text
ra skill search <query>
ra skill add <git-or-path>
ra skill list
ra skill inspect <name>
ra skill enable <name>
ra skill disable <name>
ra skill remove <name>
ra skill audit <name>
```

Track source URL, pinned commit/tag, hashes, requested permissions, trust level, last audit and update availability.

Source: https://github.com/agentskills/agentskills

### Agent Plugins
Support Agent Plugins 1.x as the distribution layer above Agent Skills and MCP servers. A plugin must never bypass RA permissions.

Source: https://github.com/agentplugins/agent-plugins-spec

### MCP
Support MCP natively, but do not preload every connected tool schema. Use progressive discovery:

```text
tool.search(query)
tool.schema(id)
tool.call(id, args)
```

### ACP
Expose RA through Agent Client Protocol so compatible editors can use RA without RA writing a dedicated extension for each one.

Source: https://github.com/agentclientprotocol/agent-client-protocol

### A2A
Later-phase support for Agent2Agent, useful for independent remote agents and distributed Temple workers.

Source: https://github.com/a2aproject/A2A

## 2. Coding-behavior upgrades

### Ponytail — adopt as a policy/skill
Core ideas:
- YAGNI;
- prefer existing/native capability;
- reuse before dependencies;
- minimum implementation satisfying acceptance criteria;
- explicit review/audit/debt modes.

RA mapping:

```text
Ptah / Builder
  minimalism_policy: off | lite | normal | ultra
```

Do not force it on research, architecture exploration, forensic debugging or tasks whose acceptance criteria explicitly demand extensibility.

Source: https://github.com/DietrichGebert/ponytail

### Superpowers — support and borrow workflow
Useful concepts:
- brainstorm before implementation;
- spec;
- executable plan;
- TDD;
- worktrees;
- subagent-driven implementation;
- explicit review;
- systematic debugging;
- skills tested like software.

RA could expose:

```text
/ritual quick
/ritual standard
/ritual rigorous
```

Source: https://github.com/obra/superpowers

### GitHub Spec Kit — blueprint workflow
Support compatible spec-driven artifacts without forcing the whole workflow on tiny fixes.

Potential commands:

```text
/blueprint feature
/blueprint bug
/blueprint assess
```

Source: https://github.com/github/spec-kit

## 3. Token and context economy

### Caveman — integrate MIT ideas; respect license boundary
Caveman currently has a split license: skill/adoption surfaces are MIT; engine-linked runtime components are BSL-1.1 source-available until their conversion date.

RA should:
- support the Caveman skill;
- offer terse response policies;
- build native tool-output compression;
- avoid copying BSL runtime code unless that licensing decision is intentional.

RA-native concept:

```text
/output normal
/output terse
/output stone
```

More important than short prose:
- summarize successful test noise;
- retain failures and totals;
- compact compiler/linter output;
- content-address full logs;
- retrieve raw artifacts only on demand.

Source: https://github.com/JuliusBrussee/caveman

### Progressive tool discovery
Never inject hundreds of MCP schemas into the model. Keep the catalog outside active context and fetch schemas only for tools selected by search.

## 4. Codebase intelligence

### Serena — strong integration candidate
Use LSP-backed semantic code retrieval/editing for definitions, references, rename, diagnostics, symbol replacement and call navigation.

Source: https://github.com/oraios/serena

### ast-grep — adopt
Structural AST search complements ripgrep and enables safer migrations/refactors.

Source: https://github.com/ast-grep/ast-grep-mcp

### Aider repo map — copy the design principle
Maintain a concise token-budgeted map of important files, symbols, signatures and relationships rather than shipping the repository tree every call.

Source: https://aider.chat/docs/repomap.html

### Claude Context — optional for very large repos
Hybrid BM25 + dense vector retrieval can be useful for huge repositories.

Policy:
- small repo: lexical + symbols;
- medium repo: repo map + lexical + symbols;
- large repo: optionally add semantic vector search.

Source: https://github.com/zilliztech/claude-context

### CodeGraph — experimental
Program-graph retrieval can answer call/dependency/impact questions. Avoid mandatory indexing on startup.

Source: https://github.com/codegraph-ai/CodeGraph

## 5. Research and external knowledge

### AgentSearch — external expert discovery
Use Luther Systems AgentSearch as a discovery source for agents/MCP servers.

Proposed UX:

```text
/bazaar find "PDF invoice extraction"
/bazaar inspect <result>
/bazaar install <result>
```

Never auto-install a discovered result.

Source: https://github.com/luthersystems/agentsearch

### Agent Search MCP — web research backend
The separate Agent Search MCP project offers free-first/self-hostable search, evidence budgets and extraction.

Source: https://github.com/lennney/agent-search-mcp

### Context7 — current library docs
Invoke when the task depends on current framework/library/SDK APIs; do not spend context on it for generic coding.

Source: https://github.com/upstash/context7

## 6. Agent/team orchestration

### Oh My OpenCode — study aggressively
High-value concepts:
- specialized agents;
- asynchronous/background agents;
- cheaper exploration agents;
- LSP/AST tools;
- conditional context injection;
- session-history tools;
- continuation enforcement;
- code-comment quality checks;
- per-provider/model concurrency;
- domain-specific delegation.

RA should go further by making local server federation, context economics and deterministic evidence routing foundational.

Canonical-source verification should be part of dependency pinning because many forks/mirrors exist.

### mini-SWE-agent — complexity baseline
Keep RA's core loop small and auditable. Benchmark orchestration features against a simple baseline so extra complexity must earn its place.

Source: https://github.com/SWE-agent/mini-swe-agent

## 7. Browser/UI verification

### Playwright CLI + Skills — default
Use for browser tests because it avoids loading large MCP schemas/accessibility trees into ordinary coding-agent context.

### Playwright MCP — optional deep browser mode
Use when persistent browser state and repeated page introspection are worth the context overhead.

Sources:
- https://github.com/microsoft/playwright
- https://github.com/microsoft/playwright-mcp

## 8. Memory

### RA-native memory first
Start with local storage such as SQLite/FTS:
- project decisions;
- failure/recovery history;
- project facts;
- model/server performance;
- user-approved persistent project preferences;
- source/timestamp/provenance for every memory.

### Mem0 — optional backend
Useful for installations needing richer cross-session semantic memory.

Source: https://github.com/mem0ai/mem0

## 9. Model-serving stack

RA should use adapters rather than marry one inference engine.

### Ollama
Best for easy local setup and experimentation.

### llama.cpp
Best for GGUF, old/mixed hardware, quantization and CPU+GPU split. Relevant server features include OpenAI-compatible APIs, continuous batching, multi-user serving, schema-constrained JSON, tool calling and speculative decoding.

Source: https://github.com/ggml-org/llama.cpp

### vLLM
Best for high-throughput GPU servers. Automatic Prefix Caching is especially relevant to repeated system prompts, repo context and multi-round agent sessions.

Source: https://github.com/vllm-project/vllm

### SGLang
Strong fit for future multi-GPU/cluster RA deployments. Relevant features include RadixAttention/prefix caching, speculative decoding, continuous batching, prefill/decode disaggregation and tensor/pipeline/expert/data parallelism, with broad Qwen/DeepSeek/Kimi/GLM support.

Source: https://github.com/sgl-project/sglang

### LiteLLM
Optional gateway for provider normalization, retries/fallbacks, spend tracking and budgets. RA should still own semantic/task-aware routing.

Source: https://github.com/BerriAI/litellm

### TGI
Do not prioritize for new work. Hugging Face archived Text Generation Inference in March 2026 and recommends moving toward vLLM, SGLang and interoperable local engines such as llama.cpp/MLX.

## 10. Security — mandatory for RA Bazaar

Assume:
- skills can contain malicious instructions;
- MCP output can contain prompt injection;
- scripts can execute code;
- updates can change permissions;
- remote servers can exfiltrate data.

Required controls:

### Provenance
Record origin, pinned revision, hashes, license and update diff.

### Permission manifest

```yaml
permissions:
  filesystem:
    read: ["workspace/**"]
    write: ["workspace/**"]
  shell:
    allow: ["git", "npm", "go", "cargo"]
  network:
    allow: ["docs.example.com"]
  secrets:
    allow: []
```

### Trust zones

```text
builtin
verified
community
untrusted
```

### Runtime isolation
Untrusted plugins get workspace-only filesystem, no secrets, restricted shell/network and sandbox smoke tests.

### Tool-response boundary
Content from webpages, MCP responses, repositories, issues and logs is data, never higher-priority policy.

### Audit UX

```text
ra plugin audit <name>
ra plugin permissions <name>
ra plugin diff <name> --update
```

## 11. Proposed RA Bazaar

```text
╭─ 𓂀 RA BAZAAR ───────────────────────────────────────────────╮
│ Search: code review security_                               │
├─────────────────────────────────────────────────────────────┤
│ ✓ superpowers        VERIFIED   skill/plugin    MIT         │
│ ✓ ponytail           VERIFIED   coding policy   MIT         │
│ ✓ ast-grep           VERIFIED   MCP/tool         MIT        │
│ ? community-reviewer COMMUNITY  skill            Apache-2   │
│ ! unknown-server     UNTRUSTED  MCP              UNKNOWN    │
╰─────────────────────────────────────────────────────────────╯
 [I] inspect   [P] permissions   [A] audit   [Enter] install
```

Install flow:

```text
discover
  ↓
resolve canonical source
  ↓
read manifest
  ↓
license/provenance check
  ↓
static security scan
  ↓
permissions diff
  ↓
sandbox test
  ↓
install pinned revision
  ↓
progressive activation
```

## 12. Integration priority

### Tier A — build into RA early
1. Agent Skills compatibility
2. Agent Plugins compatibility
3. MCP with progressive tool discovery
4. Ponytail-style minimal-code policy
5. Caveman-style communication/tool-output economy
6. LSP + AST navigation
7. Aider-style repo map
8. background local experts
9. Playwright CLI/skills
10. plugin provenance/permissions/sandbox/audit

### Tier B — adapters
1. Superpowers
2. Spec Kit
3. Serena
4. Context7
5. Agent Search MCP
6. AgentSearch discovery
7. Mem0
8. LiteLLM
9. CodeGraph
10. Playwright MCP

### Tier C — infrastructure targets
1. Ollama
2. llama.cpp
3. vLLM
4. SGLang
5. generic OpenAI-compatible APIs

### Tier D — later interoperability
1. ACP
2. A2A
3. external agent marketplaces
4. distributed Temple workers

## Product identity

Do not build “OpenCode with Egyptian graphics.”

Build:

> **A local-first coding-agent operating system that can use the open agent ecosystem, federate multiple AI servers, dynamically select experts, aggressively control context, and verify work from evidence.**

The Egyptian TUI makes RA recognizable. The architecture makes it useful.
