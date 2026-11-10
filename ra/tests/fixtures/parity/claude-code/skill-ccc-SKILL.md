---
name: ccc
description: Claude Code Concierge — searches a local RAG catalog for the best combination of Claude Code built-ins, context, plugins, skills, agents, hooks, LSPs, monitors, output styles, and MCP servers for a given task. Use /ccc <task> (or /c3 <task>). Does no web research by default, to minimize credit spend.
---
<!-- SPDX-License-Identifier: MIT -->
<!-- English localization of ccc (Claude Code Concierge) by happygoluckydev.
     Upstream: https://github.com/happygoluckydev/c3  (MIT). The deterministic
     procedure, priority rules, and cost rules are preserved verbatim in meaning;
     only the language and the output-section headers were changed. -->

# ccc (Claude Code Concierge) — recommends the best extension setup for a task

To conserve credits, do no web research by default. Search the local catalog
(`~/.claude/ccc/catalog.jsonl`) and recommend from it.

The catalog is built by a weekly crawl batch; recommending from it costs almost no
LLM tokens.

To produce the same recommendation regardless of which model runs it, follow the
steps below **mechanically**. Do not add, drop, or reword steps based on your own
judgement.

## Procedure

1. **Extract keywords (deterministic rule)**: build 4–8 lowercase English words, in this order:
   ① technical/service names taken verbatim from the task text (e.g. stripe, pdf, prisma)
   ② the canonical English translation of the core verb/noun (generate→generation, send→send, etc. — the most common single word)
   ③ one word per concept; do not list synonyms (don't include both email and mail)
   Example: "generate a PDF invoice and email it" → pdf invoice generation email send
2. **Search (exactly once)**: pass both the keywords and the **task text** (the task text is
   machine-extracted too; with vectors enabled the task text is embedded directly, so keyword
   phrasing matters less):
   `node ~/.claude/skills/ccc/scripts/search.mjs --all "<keywords>" --task "<task text>"`
   Freshness checking and rebuilding are built in. Re-search only once, and only when the
   total across all kinds is fewer than 3 hits.
3. **Select candidates (deterministic rule)**: pick the combination using this priority order:
   1. **Nothing to add** — Claude Code built-ins, existing persistent context, and already-installed
      agents/skills (source=installed) are enough, then present that first
      ("remove/reuse what you already have" is the top principle)
   2. **Anthropic-authored or Anthropic-curated plugins and feature components** — prefer maintained
      plugins; add a Hook (deterministic automation), LSP (code intelligence), Monitor (background
      monitoring), or Output Style (output formatting) only as needed
   3. **Standalone skill** — when procedural knowledge alone is enough. Prefer official
      (anthropics/skills, tags=official)
   4. **MCP server** — only when connecting to an external service is genuinely required
   5. **Standalone community agent** — to fill a gap the above leaves
   When several candidates fill the same role, break the tie mechanically:
   ① higher in the result list (= higher search score) ② if tied, installed > anthropic-authored >
   anthropic-curated > everything else. Treat `community-managed` as community, and flag it for a
   read-before-install warning. Also state which candidates are better NOT to install, with reasons.
   Always factor in **resident cost** (context consumed every session after install):
   - Resident cost by form: **skill (one description line only; body on invoke) < standalone agent
     (stays in the list) < a whole plugin (many resident assets) < MCP (tool schemas resident)**.
     For the same role, prefer the lower resident cost
   - **Don't recommend installation for a one-off task.** Recommend "reference it here and apply it
     manually" instead (install only when there's a realistic chance of reuse; avoiding the resident
     tax beats saving one prompt)
   - Hooks are for judgment-free enforcement/automation, LSPs for diagnostics and symbol search,
     Monitors for continuous watching. Don't confuse them with skills or agents
4. **Fetch details for adopted candidates only**: for the 3–5 candidates you will actually list, get
   the install command and details. Use the `id` column from the search output (`kind:name` format)
   directly, so you never confuse same-named items of different kinds:
   `node ~/.claude/skills/ccc/scripts/search.mjs --get "<kind:name1,kind:name2,...>"`
5. **Output (fixed template)**: always output these 5 sections, in this order. Do not add or remove sections.
   - `## Recommendations` — table: Kind | Name | What it does | Install command
   - `## Why these` — one line per candidate stating "which priority rule + which search rank"
     (e.g. "Rule 1: no install needed, already installed. agent search rank 1")
   - `## Skipped` — candidates you considered and rejected, with reasons (or "None")
   - `## Notes` — community read-before-install warnings, MCP resident cost, etc.
   - `## Trace` — for transparency, copy the `#` lines at the top of the search output **verbatim**
     (catalog build time, search mode, the query tokens actually used, total hits per kind), and
     list the commands you ran. Do not summarize or reword the trace — copy the machine output
     (so it stays as verifiable evidence rather than self-report). If you skipped the catalog search,
     still write this section saying you skipped it and why.

## Rules

- WebSearch/WebFetch are a last resort, only when the catalog returns no hits at all. If you use
  them, say so explicitly to the user.
- Community-authored definition files carry a prompt-injection risk, so always attach a
  "read the contents before installing" warning to the recommendation.
- MCP servers have a resident context cost, so only recommend one when an external connection is
  actually needed.
- Treat install recommendations and removal recommendations with equal weight. If the user asks for an
  inventory of their assets, a cleanup, or a context reduction, measure unused agents and resident
  tax (tokens/session) with `node ~/.claude/skills/ccc/scripts/prune.mjs` and offer to move them to
  agents-archive/ with `--apply`.
- To add catalog sources, edit scripts/build-index.mjs.
