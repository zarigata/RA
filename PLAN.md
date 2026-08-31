# RA 2.0 — Master Plan

> .71 update: inherited agent/tool permissions and native macOS subprocess isolation now have installed-user safety coverage. See `ra tests/SAFETY_RESULTS.md`. Linux/Windows backends, trusted plugins/HTTP transport isolation, broad package-manager workflows, and security certification remain open. The older matrix below is a historical audit, not a current competitor comparison.


> 2026-08-30 implementation update: `.70` wires `ra agents`, `ra moa`, and `ra swarm` into CLI/TUI, with shared execution budgets, retained partial results, isolated task worktrees, explicit integration, and conflict recovery. See `ra tests/AGENT_RESULTS.md` for installed-terminal evidence. The phase descriptions below remain the broader roadmap; automatic conflict resolution and OS isolation are not completed.


> The long, deep plan to make RA as good as — or better than — Claude Code,
> OpenCode, Crush, aider, and Codex CLI. Born from the 2026-08-25 competitive
> audit (see `EVALUATION.md` for the current-state evidence).
>
> **Strategic thesis.** The landscape has a hole: no tool combines OS-level
> sandboxing (Codex), Charm-grade TUI (Crush), and platform surface (OpenCode).
> RA's unclaimed lane is the **LAN-first, small-model-friendly Mixture-of-Agents
> coding agent**: models on your own hardware (`.251`), cloud only when needed,
> MoA diversity instead of single-model trust. Nobody else does this. Every
> phase below serves that lane first, parity second, novelty third.
>
> **Approved architecture decisions (2026-08-25).**
> - TUI: custom zero-dependency renderer (bubbletea-style Elm architecture:
>   Model/Msg/Update/View), built progressively behind `ra.json` `ui.mode`
>   while the readline UI keeps working. No Ink, no React, no blessed.
> - Build order: engine first (trustworthy agent), then TUI renaissance.
> - Open-source bases we may study (license-safe): sst/opencode (MIT),
>   openai/codex (Apache-2.0), google-gemini/gemini-cli (Apache-2.0),
>   paul-gauthier/aider (Apache-2.0). claude-squad is AGPL — study only,
>   never copy code.

## Competitive target matrix

What "as good as Claude Code / OpenCode" concretely means, and where RA stands
(audit-verified). ✔ have · ◐ partial · ✖ missing:

| Capability | Claude Code | OpenCode | Crush | RA today | RA target |
|---|---|---|---|---|---|
| Streaming token render | ✔ | ✔ | ✔ styled | ✖ (stream:false) | Phase 0 |
| Latency hygiene (keep-alive/warm) | n/a (cloud) | n/a | n/a | ✖ (55s cold loads) | Phase 0 |
| Context compaction (/compact, auto) | ✔ + micro + partial | ✔ | ◐ | ✖ (200-msg cap only) | Phase 0 |
| Honest eval harness | internal | ◐ | ◐ | ◐ (gameable stubs) | Phase 0 |
| Interrupt turn (Esc) + queueing | ✔ | ✔ | ✔ | ✖ (Ctrl+C killed app; fixed survival, no abort) | Phase 1 |
| Plan mode + permission cycling | ✔ shift+tab | ✔ Tab build/plan | ✖ | ✖ | Phase 1 |
| Memory hierarchy (RA.md/CLAUDE.md) | ✔ deep + auto-memory | ✔ AGENTS.md | ◐ | ◐ (flat AGENTS.md only) | Phase 1 |
| Subagents (custom + parallel + UI) | ✔ rich | ✔ | ✖ (#431!) | ◐ (TASK verb + tree, no files/config) | Phase 1 |
| Skills runtime (SKILL.md) | ✔ spec owner | ✔ | ✔ agentskills.io | ✖ (22 skills on disk, unread!) | Phase 1 |
| Git discipline (auto-commit/undo) | ◐ | ✔ /undo+/redo | ◐ | ◐ (checkpoints, single-level) | Phase 1 |
| $EDITOR compose / transcript | ✔ | ✔ /editor | n/d | ✖ | Phase 1 |
| Fuzzy palette | ✔ | ✔ ctrl+p | ✔ ctrl+p | ◐ (number-key only) | Phase 2 |
| Mouse + alt-screen + markdown | ◐ | ✔ | ✔ best-in-class | ✖ (proven: no mouse-mode ANSI) | Phase 2 |
| Diff approval UI (hunks) | ✔ | ✔ | ✔ | ✖ | Phase 2 |
| Session share | ✔ | ✔ /share links | ✖ | ✖ | Phase 2 |
| MoA / model diversity | ✖ | ✖ | ✖ | ◐ pipeline exists, aggregation fake | Phase 3 (win) |
| Repo map (tree-sitter, git-weighted) | ◐ | ◐ | ◐ | ✖ (OUTLINE seed exists) | Phase 3 |
| LSP integration | ✔ .lsp.json | ✔ | ✔ deepest | ◐ (LspClient written, unwired) | Phase 3 |
| OS sandboxing (Seatbelt/bwrap) | ✔ | ◐ | ◐ | ✖ | Phase 3 |
| LAN-first routing + cascade | ✖ | ◐ local autodisc | ◐ | ✔ unique (251→cloud) | Phase 3 (win) |
| Worktree parallel agents | ✔ | ◐ | ✖ | ◐ (swarm.ts written, unwired) | Phase 3 (win) |
| Client/server + IDE + web | ✔ | ✔ OpenAPI+SDK | ✔ multi-client | ◐ (daemon=sessions only) | Phase 3 |
| Voice / images | ✔ both | ◐ | ◐ | ✖ (qwen3.8 has vision — free win) | Phase 1 (images) |
| Statusline / notifications | ✔ | ✔ | ✔ | ✖ | Phase 1-2 |

---

## Phase 0 — Trustworthy Engine  *(starts now)*

**Goal:** the agent becomes fast-feeling, reliable, honest, and context-safe.
No new surfaces — make what exists real.

### 0.1 Streaming everywhere
- `nativeChatStream(model, messages, opts, onToken?)` in `anubis/src/ollama.ts`:
  native Ollama `/api/chat` with `stream:true` (NDJSON lines → delta JSON),
  cloud/OpenAI-compat `/chat/completions` SSE (`data:` frames → choices delta).
- Pure parser functions (`parseOllamaStreamLine`, `parseSSEFrame`) so the
  parsing is unit-testable without a server.
- Same return contract as `nativeChat` (`{content, model, usage}`); final-chunk
  usage when present, chars/4 heuristic otherwise (existing fallback).
- Agent loop (`runTaskAgent`) uses the stream method; tokens forwarded to a
  module-level renderer (`setActiveStreamRenderer`) the TUI installs;
  headless runs just accumulate.
- TUI: readline-safe incremental print (write chunks, newline on completion,
  re-prompt after). Kills the 60s-dead-air problem together with 0.2.
- Abort plumbing: AbortController created per turn, exposed via
  `abortActiveTurn()` (used by Phase 1 Esc).

### 0.2 Latency hygiene
- `keep_alive` in every native request body (top-level field), default
  `"30m"`, configurable via `ra.json` `keep_alive` + `OLLAMA_KEEP_ALIVE` env.
- `ra warm [--model X]` CLI: loads the small model on `.251` (empty-prompt
  generate trick) and pings cloud; prints timings.
- TUI start: fire-and-forget background warm ping (no await, errors ignored).
- `ra doctor` reports keep_alive config.

### 0.3 Loop-level retry & fallback
- `withRetry(fn)`: one retry with 600ms backoff on transient errors (timeout,
  5xx, ECONNRESET, ECONNREFUSED) — pure, unit-tested.
- `runTaskAgent` wraps chat calls; on second failure routes through the
  existing `runWithFallback` chain and emits `model.fallback` hook (already in
  `KNOWN_HOOKS`).

### 0.4 Context compaction
- Char-budget tracker per session; threshold configurable (`context_limit`,
  default ~80% of 32k-equivalent chars for small, higher for cloud/qwen 262k).
- `compactMessages(messages, keepSystem=true)`: middle segments summarized by
  the small model into `<summary>` block; persona + project memory + last
  6 turns preserved verbatim.
- `/compact [focus]` command + auto-compact before overflow + `context.compact`
  hook event. Status footer shows context usage %.

### 0.5 Honest evaluation
- Remove `ensureTaskArtifacts` stub-writing from the live ptah path (keep only
  behind `benchmark_compat: true` config for legacy scenario runs).
- Eval verification upgrades: run generated code in a sandboxed temp dir
  (`bun run`/`python3`) and assert stdout where the task defines expected
  output; keep regex checks as a fallback tier.
- Benchmark runner: replace hand-rolled YAML parsing edge cases (duplicate
  `file_contains` lines) — port a correct minimal parser with tests.
- Gate: eval pass-rates before/after every prompt change (already the
  convention; now the numbers become trustworthy).

### 0.6 Real MoA aggregation
- `/moa` currently prints the aggregation *prompt* — fix: run
  `buildAggregatePrompt` through the small model, return the synthesized
  answer.
- `surfaceDisagreements(results)`: pure helper flagging conflicting
  conclusions/files between role outputs; shown under the aggregate.
- Foundation for Phase 3's model-diversity voting.

### 0.7 Wire the orphans (partial)
- `selfheal.ts` → ptah verify step: after DONE with file writes, run
  project test command (config `verify_command`, default `bun test` /
  `python3 -m py_compile` fallback via DIAGNOSE), on failure run the
  diagnose→fix loop (max 2 rounds), log to BUGS.md as today.
- `search.ts` stays lexical but gets wired as a `SEARCH <query>` tool verb
  (real embeddings deferred to Phase 3.5).
- `swarm.ts` wiring deferred to Phase 3.2 (needs UX design first).

### 0.8 Custom commands, fixed
- Loader reads project `.ra/commands/*.md` + user `~/.ra/commands/*.md`
  (repo-relative legacy dir stays as fallback); `$ARGUMENTS`, `$1..$N`
  substitution; optional frontmatter `model:`, `allowed-tools:`, `agent:`
  (which role runs it — default `anubis`).
- `ra commands` lists them; palette includes them.

### 0.9 Todos, visible
- `TODO` tool upgrades: `TODO edit <id> <text>`, `TODO rm <id>`, stable ids.
- `/todos` command: renders `☐/☑` list from `.ra/todos.json`; `/todos done <id>`
  toggles. TUI prints the open-todo count in the status line after replies.

**Phase 0 exit criteria:** PTY test shows visible token streaming on `.251`
and cloud; second-turn latency < 5s warm; `/moa` returns a real synthesized
answer; `/compact` halves context with task continuity (eval spot-check);
todos visible; gate green; eval honesty verified by stub-removal A/B.

---

## Phase 1 — Claude Code Core Parity

**Goal:** the interaction model people expect from a 2026 agent CLI.

### 1.1 Permission modes + plan mode
- `shift+tab` cycles `default → accept-edits → plan` (config
  `permission.default_mode`); indicator in the prompt line.
- Plan mode: agent perms forced read-only (edit/bash deny), ptah planning
  persona used, `/plan` entry; on exit, plan text persisted to
  `.ra/plan.md` and injected into the implementation turn; survives
  `/compact`.
- `accept-edits`: write/edit/multiedit auto-approved, bash still gated.

### 1.2 Interrupt, queueing, rewind
- `Esc` aborts the active turn via the 0.1 AbortController; partial output
  kept with `[interrupted]` marker.
- Typing while busy queues (queue exists — surface queued count above the
  prompt; Esc flushes).
- `Esc Esc` rewind menu: list checkpoints (fix the fold-all-into-one bug in
  `checkpoint.ts` first — per-turn checkpoint ids), restore code /
  conversation / both.

### 1.3 Memory hierarchy + auto-memory
- Load order: `~/.ra/RA.md` → `RA.md`/`AGENTS.md` at repo root → per-dir
  `RA.md` loaded on-demand when files in that dir are read → `RA.local.md`.
- `@path` imports (4-hop cap); `/memory` opens `$EDITOR` on the project file;
  `/init` generates a starter RA.md (project tree + conventions via small
  model).
- Auto-memory: at session end, small model appends durable facts to
  `~/.ra/memory/MEMORY.md` (max 200 lines loaded at start).

### 1.4 `/context` grid
- Breakdown: system prompt, personas, memory files, messages, tool outputs,
  MCP schemas, free — with colors and optimization hints (which file eats
  the window).

### 1.5 Formal subagents
- `.ra/agents/*.md` + `~/.ra/agents/*.md`, Claude-compatible frontmatter:
  `description, tools, model, maxTurns, temperature, isolation
  (worktree|session), color`. Existing TASK verb + tree panel become the
  runtime; `@agent` mention routing; parallel fan-out with live tree cards;
  `ra agents` lister. The 3 built-ins (general/explore/scout) migrate here.

### 1.6 Skills runtime *(biggest free win — 22 skills already on disk)*
- Loader for `.agents/skills/*/SKILL.md` (agentskills.io: description
  frontmatter, body, optional `references/`, `scripts/`) + `~/.ra/skills/`.
- Progressive disclosure: descriptions in TOOL_HINT budget-capped appendix;
  `/skill-name` invokes body; `$ARGUMENTS` substitution; scripts run via BASH
  perms; `disable-model-invocation` respected.
- A `SKILL <name> <args>` tool verb for model-initiated invocation.

### 1.7 Session UX
- `ra -c` continue / `ra -r [id]` resume picker (list + fuzzy number select);
  session titles auto-generated by the small model (first turn, background);
  `/rename`; session fork before experimentation.

### 1.8 Git discipline (aider pattern)
- Config `git.autocommit` (default **off** for trust; prompt to enable):
  commit per AI edit-batch with `(ra)` attribution + generated message.
- Dirty-file protocol: before editing a file with uncommitted user changes,
  commit those first (separating human/AI work).
- `/undo` → checkpoint restore + `git revert` of the last `(ra)` commit;
  `/diff` already exists — upgrade to show staged-vs-checkpoint.

### 1.9 Editor + transcript + input upgrades
- `Ctrl+G` compose in `$EDITOR` (temp file, `--wait` for GUI editors);
  `Ctrl+O` transcript viewer (less-style pager in Phase 2, plain print now).
- `@file` fuzzy completion (tab-cycle list), `@file#10-42` line ranges
  (expandMentions upgrade).
- Image input: `@img.png` → base64 image content part (qwen3.8 vision +
  cloud multimodal); `[Image #N]` chip display.

### 1.10 Statusline + notifications
- Configurable `statusline.command` fed JSON (model, cwd, tokens, cost,
  context %, git branch); default built-in bar. OSC 9 / bell notification on
  turn end when terminal unfocused.

**Phase 1 exit criteria:** PTY test drives plan→approve→implement→undo;
memory files load per hierarchy (unit test); a `.agents/skills` skill invoked
via slash command alters agent behavior; subagent file with custom frontmatter
honored; queueing + interrupt verified live; gate + eval green.

---

## Phase 2 — TUI Renaissance (custom zero-dep renderer)

**Goal:** OpenCode/Crush-class interface without adopting a framework.

### 2.1 Renderer core (`ra/src/tui/render/`)
- Elm architecture: `Model`, `Msg`, `update(model, msg)`, `view(model)`
  returning a line-buffer; a `runtime.ts` owning the tty: raw mode,
  alt-screen (`?1049`), sync output (`?2026` when supported), resize events,
  focus events (`?1004`), dirty-region diffing repaint.
- Layout primitives: vertical stack, viewport (scrollback), input box with
  cursor/editing (readline-equivalent bindings + multiline + bracketed
  paste), borders/panes.
- `ui.mode: "classic" | "modern"` in ra.json; classic readline remains the
  default until 2.4 lands.

### 2.2 Mouse (SGR `?1006`)
- Click: palette options, todo checkboxes, diff hunks, transcript
  file:line → `$EDITOR` jump. Wheel: transcript scroll. Shift-drag preserves
  native selection (forward the right modes).

### 2.3 Fuzzy palette
- Ctrl+P: single-line fuzzy matcher (subsequence score, à la fzy — ~80
  lines), arrows + enter, over commands + agents + skills + custom commands
  + files (`>` prefix) + sessions (`@>`). Ctrl+X leader chords for the rest.

### 2.4 Markdown + syntax highlighting
- Mini renderer: headings, lists, bold/italic, fenced code with a ~150-line
  highlighter (ts/js/py/json/bash/go keywords + strings + comments), ANSI
  theme-aware. Streaming-aware: re-render the in-progress block cheaply.
- Tool-call blocks rendered as collapsible cards (WRITE file +N lines,
  BASH cmd + status), spinner frames while running.

### 2.5 Diff approval UI
- ask-mode EDIT/WRITE renders a hunk view (uniform diff, +/- coloring,
  width-adaptive side-by-side) with `y/n/a(ll)/e(dit in $EDITOR)` keys —
  Crush's decisive pattern.

### 2.6 Themes everywhere + polish
- ui.ts palettes drive ALL rendering (today: splash only). Status bar:
  model@host, context %, cost, mode indicator, git branch. Notifications.
  Optional vim-mode input bindings (Phase 4 if time).

### 2.7 `/share` + `/export`
- Daemon serves a read-only transcript page at `/share/<id>` (LAN or
  tailnet; opt-in, redacted via existing `redact()`), `/export` markdown.

**Phase 2 exit criteria:** PTY + screenshot tests of alt-screen/mouse/palette
/markdown/diff-approval; `ui.mode: modern` passes the full command surface;
classic mode still gate-green; renderer < 2.5k lines total, zero deps.

---

## Phase 3 — The Better-Than Lane (differentiators)

### 3.1 MoA 2.0
- Same task to N *diverse* models (qwen3.8@gpt-oss:20b@gemma4:12b on `.251`,
  optionally one cloud): parallel, live cards, cross-model disagreement
  report (0.6 helper grown up), confidence-weighted synthesis by BIG.
- Eval-gated router: task class → best-model mapping learned from `ra eval`
  runs stored in `.ra/router-stats.json`.

### 3.2 Swarm UX
- `/parallel <task1> | <task2> | ...` → swarm.ts worktrees, live progress,
  merge report; conflicts trigger a maat-agent resolution pass; `.worktreeinclude`
  support. Subagent `isolation: worktree` reuses it.

### 3.3 Repo map + LSP loop
- Git-weighted tree-sitter-style symbol map seeded from OUTLINE +
  `git log --name-only` recency scoring; injected as a compact map block for
  explore/general agents (aider's proven recipe).
- Wire `LspClient` (written in Cycle 42, dead since): DIAGNOSE prefers LSP,
  falls back to tsc/py_compile; post-edit diagnostics auto-run on touched
  files, errors fed back to the agent loop automatically.

### 3.4 Sandboxing (Codex pattern)
- macOS Seatbelt (`sandbox-exec`) profiles: `read-only`, `workspace-write`
  (default for BASH in default permission mode), `full` — config-gated;
  network off unless allowlisted; Linux bwrap later.

### 3.5 LAN-first cascade + model switching
- Small-attempts-first: run qwen3.8; on structured failure signals (empty
  content, no tool calls used, eval-verifier fail) escalate the SAME turn to
  cloud — user sees "escalated to glm-5.2 (reason)".
- Mid-session `/model X` switch preserving context (Crush flagship);
  cost/latency live dashboard (`/lanes` grown into a TUI page).

### 3.6 Real semantic search
- bge-m3 on `.251` (`/api/embeddings`) → chunk-index the repo on `ra index`;
  `SEARCH` tool verb becomes vector search with lexical fallback; explore
  agents cite by similarity.

### 3.7 Daemon as platform
- Move the agent loop into `ra daemon`: SSE event bus (`/events`), HTTP API
  (sessions, turns, tools, permissions), TUI becomes a client (RemoteClient
  grows into it); OpenAPI-ish schema; upgrade the HTML dashboard to a real
  web console; VS Code extension via the HTTP API (replace the JSON-RPC
  stdio bridge or adapt it with Content-Length framing).

**Phase 3 exit criteria:** MoA beats single-model on the eval suite (measured);
swarm demo merges 3 parallel tasks cleanly; LSP catches a real type error
post-edit in a PTY test; sandbox blocks an out-of-workspace write; daemon
serves a second attached client concurrently.

---

## Phase 4 — Ecosystem & Polish

- Pack format: a directory of `skills/ agents/ commands/ plugins/ hooks/`
  installable by git URL (`ra pack add <url>`), Claude-format compatible
  where licenses allow; lockfile like `skills-lock.json` but actually loaded.
- models.dev provider catalog sync (`ra models` becomes a real picker).
- Voice input (`/voice`, whisper-class model on `.251` or cloud).
- Docs site from `BUILD/` + `docs/`; ADR for every phase decision in
  `DECISIONS.md`; `ra doctor` grows subcommands for each subsystem.
- Stretch: multi-client collaborative sessions (Crush workspaces pattern).

---

## Standing engineering rules

1. **Gate:** `./test.sh` green + new unit tests for every change; eval
   before/after for anything touching prompts/model behavior; PTY test for
   anything touching the TUI.
2. **Zero runtime deps** in both packages unless a phase decision explicitly
   overturns it (record an ADR).
3. **Personas/config over code:** behavior changes land in
   `.anubis/agents/*.md` + `ra.json` where possible.
4. **Every phase updates** STATUS.md cycle log + CHANGELOG + this file's
   matrix.
5. **Security:** no keys in-tree ever again (Cycle-43 lesson); redaction on
   all persisted transcripts; share/export redact by default.

## Progress log

- **2026-08-25:** Plan written; Phase 0 core landed and live-verified: 0.1
  streaming (both transports, TUI render, root-turn gating), 0.2 keep-alive +
  `ra warm` + TUI warm-up, 0.3 retry (loop-wired), 0.6 MoA aggregation +
  disagreements, 0.8 custom commands (dirs + args + agent frontmatter), 0.9
  todos UI. Remaining Phase 0: 0.4 compaction, 0.5 honest-eval stub removal,
  0.7 selfheal/SEARCH wiring. Then Phase 1.
