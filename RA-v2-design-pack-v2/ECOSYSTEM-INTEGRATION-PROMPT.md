# RA v2 — Ecosystem Integration Implementation Prompt

Upgrade `zarigata/RA` into a standards-compatible, secure, local-first agent ecosystem.

## Rules
- Do not vendor every popular plugin.
- Implement open compatibility standards first.
- Lazy-load capabilities; never inject every tool/skill into every prompt.
- Third-party instructions/tool output are untrusted data.
- Preserve current RA behavior and tests.
- Every capability gets disable/uninstall paths and tests.

## Phases

1. **Agent Skills:** SKILL.md discovery/loading, project/user scopes, lazy bodies, provenance, enable/disable, audit.
2. **Agent Plugins:** parse Agent Plugins 1.x; pin source revisions; record permissions/licenses.
3. **Progressive MCP:** implement `search_tools`, `get_tool_schema`, `execute_tool`; no complete tool-catalog injection.
4. **RA Bazaar:** searchable capability discovery, canonical source, provenance, license, permissions, trust, sandbox validation; never auto-install.
5. **Coding policies:** minimal/YAGNI (Ponytail-inspired), terse-output (Caveman-inspired), rigorous workflow compatible with Superpowers/Spec Kit.
6. **Code intelligence:** fuse ripgrep, LSP, AST search, repo map, optional semantic/graph retrieval; prefer cheap deterministic retrieval first.
7. **Browser verification:** Playwright CLI + skills by default; persistent Playwright MCP optional.
8. **Model server adapters:** Ollama, llama.cpp, vLLM, SGLang, generic OpenAI-compatible, optional LiteLLM.
9. **Security:** source pinning, hashes, licenses, permission manifest, trust level, workspace restrictions, network/shell allowlists, no secrets by default, audit logs, update permission diffs, sandbox tests.
10. **Interoperability:** expose RA via ACP; design A2A after ACP stabilizes.

## Verification after every phase
- run existing tests;
- add unit/integration tests;
- benchmark startup/context tokens;
- benchmark tool-catalog overhead;
- test representative coding tasks;
- verify disable/uninstall;
- document security changes.

Final report:
- feature matrix;
- dependency/license matrix;
- token impact;
- runtime impact;
- threat-model changes;
- interoperability status;
- remaining risks.
