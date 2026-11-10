# RA — Stylish CLI + Initial Model Setup (Cursor brief)

**What this is:** a self-contained implementation brief for the RA repo
(`github.com/zarigata/RA`, commit `0f0ad0a`, stardate versioning, Bun + TypeScript).
It covers two linked pieces of work only: (a) make the terminal CLI visibly
more stylish without changing its identity or adding dependencies, and
(b) add a visible, active first-run model setup — the "Model Designer" —
that actually searches for local AI servers (Ollama, LM Studio, llama.cpp)
and lets the user pick a small model and a big model before RA does any
work. Everything in this file is grounded in the code as it exists today;
nothing here invents a file, a function, or a test result.

**How to use it in Cursor:** save this file in the repo root as
`docs/CURSOR-RA-CLI-SETUP.md`, open the repo in Cursor, switch to Agent
mode, paste the "Cursor prompt" in §1 as your first message, and let it
work through §4–§5 in order. Review the diff, run the checks in §6, then
commit and push with the steps in §7. Do not paste API keys, `.env`
contents, or any local machine address into Cursor or into the commit.

**Status of RA right now is saved in §0 below** — re-verified fresh on
2026-11-09, not copied from the KING plan. Update §0 (and only §0)
whenever the status is re-checked; leave the rest of the brief alone
unless the work itself changes.

---

## 0. STATUS — saved 2026-11-09 (pre-implementation baseline)

> **Saved:** 2026-11-09 04:14 UTC (01:14 America/Sao_Paulo), by GlaDos.
> Re-verified fresh that morning by re-running the commands below on a
> clean clone — same numbers as the KING plan, no change in the repo.
> **This is a pre-implementation snapshot. None of the work in §4–§5
> has been done yet.** There is still no `ra setup` command in the repo.

| Item | Status now |
|---|---|
| Repo / commit | `github.com/zarigata/RA`, `main` @ `0f0ad0a` — "fix(install-ra): add_path returned 1 when shell rc file absent". `git fetch` on 2026-11-09 found **no newer upstream commit**. Working tree clean. |
| Version | Stardate versioning (`RA_VERSION`, e.g. `26856.9` for 2026-11-09; computed from `(year−2000)·1000 + dayOfYear/365.25·1000`), Bun 1.4.4 + TypeScript, ~14,267 LOC across 59 TS files in `ra/` + `anubis/src` |
| CLI boots? | ✅ Yes. `bun ra/src/cli.ts --version` prints `RA <stardate>` / `RA prefer small@local → big@cloud (localhost fallback)`. `help` prints the full command surface. |
| `ra doctor` | ⚠️ Diagnoses, does not fix. `✓ bun`, `✓ RA home`, `✓ ra.json`. `✗ local http://localhost:11434 — ECONNREFUSED`, `✗ Ollama small reachable`, `✗ Small Ollama LAN / localhost`, `○ OLLAMA_API_KEY not set`, `○ no RA lane yet (run ra demo or /quick)`. **No usable model on this machine.** |
| Anubis tests | ✅ **236 pass, 5 skip, 0 fail** (241 tests, 35 files, 607 expects). Skips are live-Ollama tests. Command: `cd anubis && bun test` |
| RA tests | ⚠️ **275 pass, 7 fail** (282 tests, 32 files, 1001 expects). Command: `bun test ra/tests` |
| RA failures (same 7, by name) | 1. `REPOMAP tool > collectRepoEntries finds this repo's tracked sources` — brittle test, not a product bug (first 30 `git ls-files` entries are `.agents/skills/*`, so `agent.ts` never makes the top 30). 2–7. One root cause, no `bubblewrap` on Linux, sandbox fails closed: `TEST runs the detected runner`, both swarm tests (`createWorktree` / `runSwarm`), `bash pattern rules allow whitelisted commands`, both MCP stdio tests. With `RA_ALLOW_UNSANDBOXED=1` the KING plan recorded 281 pass / 1 fail (the REPOMAP test only). |
| Release gate | ⚠️ Curated subset 141 pass / 0 fail, `bun compile` of the CLI succeeded; **install-launcher smoke did not finish within 280 s — inconclusive, not green.** See KING plan §1. |
| Live end-to-end run | ❌ **Not verified.** No Ollama server and no API key on this machine, so no `ra run` / `ra demo` / eval executed a real model call. Do not claim live coding quality from this snapshot. |
| `ra setup` command | ❌ **Does not exist yet.** `ra/src/cli.ts` (811 lines) has no `ra setup` dispatch. This brief (§5) is the proposal to add it. |
| CLI styling today | Thin but real: Egyptian gold / papyrus `pharaonic` theme, `𓂀` glyph, splash, fuzzy `/` palette. No lane / cost / context-pressure in the header, no status line, no setup state on the splash. See §3.1. |
| Local AI discovery today | Exists, buried, not in first-run: `anubis/src/lan.ts` (`scanHost`, `scanSubnet`, `buildLanConfig`), `anubis/src/ollama.ts` (`discoverLocalOpenAI`, `pickOllamaEndpoint`), `anubis/src/ping.ts` (`pingUrl`). `/lan-scan` hardcodes `192.168.1.0/24`; `scanSubnet` fires 762 fetches at once with no progress. See §3.3. |
| Hermes — confirmed | ✅ **Hermes = the assistant, NOT the model** (confirmed by Nicholas, voice call 2026-11-09). Day-to-day personal assistant (Telegram, WhatsApp, whatever Hermes has) **and** a reliable coding agent, always-on / never stops. Flexible models: local Ollama, LAN Ollama, a friend's Ollama, Ollama Cloud, or normal cloud models. Local model = detector / triage: RA tests a project (website / SaaS), passes what happened to the bigger model, bigger model fixes it, via Mixture-of-Agents and agentic tools. **There is no Hermes code in the repo** (`grep -ri hermes` = 0 hits) — it is a build, not a fix. Setup in §5 must therefore store *lanes* (small / big), never hardcode one host or model family. |
| This brief itself | Proposal only, 794 lines at save time. Not yet in the repo, not yet implemented, not yet committed. Destination when ready: `docs/CURSOR-RA-CLI-SETUP.md` (see §7). Companion plan: `RA-king-plan.md` (§1 test results, §6 Hermes, §7 phases). |
| Open decisions still pending | §8: LAN scan opt-in vs always-on; cloud provider list for setup; whether `ra setup` should also install `bubblewrap` / run `ollama pull`. Plus KING plan §9: keys / budget, repo ownership (fork vs upstream PRs), OS priority. |

**How to re-save this status next time:** re-run, on a fresh clone, `bun
ra/src/cli.ts --version`, `bun ra/src/cli.ts doctor`, `cd anubis &&
bun test`, `bun test ra/tests`, and `git log --oneline -1` /
`git fetch origin`. Replace the table above with the new numbers and
date, and update the "Saved:" line. Do not rewrite history — if a
number changes, say what changed and why. Do not paste any API key,
`.env` content, or machine-specific host IP into this section.

---

## 1. Copy-paste Cursor prompt

> Implement the RA CLI style refresh and the initial model setup exactly
> as specified in `docs/CURSOR-RA-CLI-SETUP.md` (§4 and §5), in that
> order, against commit `0f0ad0a`.
>
> Constraints, in priority order:
> 1. Bun + TypeScript only. No new dependencies. No new native modules.
> 2. Keep the Egyptian gold / papyrus identity. Default theme stays
>    `pharaonic`. Do not rename the product, the `𓂀` brand glyph, or
>    the `ra` command.
> 3. `RA_ASCII=1` and `TERM=dumb` must keep producing a fully usable,
>    plain-ASCII CLI. Never emit a Unicode glyph, emoji, or true-colour
>    escape in ASCII mode. Every new pure helper needs an ASCII test.
> 4. Reuse the existing discovery code. Do not write a second Ollama /
>    LM Studio prober. Extend `anubis/src/lan.ts` (`scanHost`,
>    `scanSubnet`, `buildLanConfig`) and `anubis/src/ollama.ts`
>    (`discoverLocalOpenAI`, `pickOllamaEndpoint`) instead of
>    reimplementing them. Do not call the current `scanSubnet` from
>    any UI — it fires 762 fetches at once with no progress callback
>    (see §3.3); add the bounded, progress-reporting variant in §5.3
>    first.
> 5. Never write a secret to git. API keys stay in `.env` under
>    `~/.ra/` (or `RA_HOME`) with the existing `{env:VAR}` templating
>    in `anubis/ra.json`. The setup wizard may ask for a cloud key,
>    but it must write it to `.env` only, never to `ra.json`, and
>    never print it.
> 6. Small, reviewable diffs, one file at a time. Add the tests in
>    §6 as you go; do not claim a step is done until its tests pass
>    with `bun test` and the release gate in `scripts/verify-release.sh`
>    still passes.
> 7. If a requirement in this brief conflicts with a test that
>    already exists, stop and say so in the reply instead of silently
>    changing the test's expectation. The only test you may change
>    without asking is the brittle REPOMAP test named in the KING
>    plan (§7 of `RA-king-plan.md`, if present in the repo) — and
>    only in the way that brief describes.
>
> Deliverable: the code changes in §4–§5, the tests in §6, and an
> updated `README.md` Quick-start section that shows `ra setup`
> before `ra` / `ra doctor`. Nothing else. Do not touch the agent
> loop (`ra/src/agent.ts`), the Hermes assistant, the MoA code, or
> the sandbox.

---

## 2. Context: why this, why now

RA already has the hard parts — 76 agents, Mixture-of-Agents, Provider
Mosaic routing, checkpoints, worktree swarms — but a first-time user
sees none of that. Today `ra` opens with a splash and a theme picker,
and `ra doctor` then reports `Ollama ECONNREFUSED` and "no RA lane
yet". The discovery code that could fix that exists, but it is buried:
`/lan-scan` in `ra/src/commands/index.ts` hardcodes `192.168.1.0/24`,
and the local-server probers only run as a last resort inside
`pickClientForModel`. The goal of this brief is the first five minutes:
a stylish CLI that looks intentional, and a setup that visibly finds
the user's models, lets them pick a small (detector / triage) model
and a big (fixer) model, proves both with a ping, and saves that
choice — so the next `ra` run actually works. This also feeds the
confirmed Hermes design: Hermes is the assistant, not a model, and
it must work with flexible model choice — local Ollama, LAN Ollama,
a friend's Ollama, Ollama Cloud, or normal cloud models — with the
local model as the detector and the bigger model as the fixer, via
Mixture-of-Agents. Setup must therefore store *lanes* (small / big),
never hardcode one host or one model family.

---

## 3. Current state — what already exists vs what is missing

All findings below were checked in the code at commit `0f0ad0a`.
Line numbers are approximate (the file, function, and behaviour are
the ground truth, not the exact line).

### 3.1 CLI styling — exists, but thin

| Piece | Where | What exists today |
|---|---|---|
| Glyphs + header | `ra/src/tui/chrome.ts` — `UNICODE_GLYPHS` / `ASCII_GLYPHS`, `useAsciiGlyphs`, `getTuiGlyphs`, `buildHeader`, `buildInputLabel`, `footerHints`, `workspaceLabel`, `shortModel` | Brand `𓂀`, user `›`, assistant `◆`, warning `▲`, busy `◉`, idle `○`. ASCII set is `RA`, `>`, `*`, `!`, `|`, `o`, `git`. `useAsciiGlyphs` is true when `RA_ASCII=1`, `RA_ASCII=true`, or `TERM=dumb`. `buildHeader` has three widths: `<68` (brand + version + profile only), `<108` (`S:` / `B:` short models), `>=108` (full `small … · big …`). No lane, cost, or context-pressure in the header. |
| Splash | `ra/src/tui/splash.ts` — `LOGO` / `ASCII_LOGO`, `TAGLINE = "R E L I C   A G E N T"`, `renderSplashFrame`, `mixColor`, `parseOscColorReply`, `luminance` | Gradient block-letter `RA` over a dim tiled background, tagline + `v<version> · press any key to begin`. Pure and testable. No model / lane / setup status on the splash. |
| Palettes | `anubis/src/ui.ts` — `PALETTES`, `getPalette`, `listPalettes`, `formatBox`, `DEFAULT_UI_CONFIG` | 11 palettes. Default is `pharaonic`: foreground `#fef08a`, background `#3f2c00`, accent `#fbbf24`, muted `#78350f`, success `#84cc16`, warning `#eab308`, error `#ef4444`. `formatBox` supports `single` / `double` / `rounded` (default) / `none`. `UiConfig.borderStyle` defaults to `rounded`. |
| TUI app | `ra/src/tui/app.ts` — `startTui`, `startFullscreen` (1027 lines), `SPINNER = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"]`, `TIPS` | Full-screen TUI: splash (1600 ms timeout, any key skips; `RA_NO_SPLASH=1` skips it), OSC 11 background detection (500 ms timeout, light terminal → `papyrus`, dark → `pharaonic`), fuzzy `/` palette, right-click menus, mouse, markdown rendering, cost sidebar. `RA_LEGACY_TUI=1` or non-TTY falls back to `ra/src/tui/legacy.ts`. |
| Overlays | `ra/src/tui/overlays.ts` — `renderMenuOverlay`, `renderShortcutsOverlay`, `renderOnboardingOverlay` | Onboarding is a pure renderer returning lines + hitboxes. It has exactly two steps (see §3.2). Menus use `╭─╮ / │ / ╰─╯` boxes with a `▌` selected marker. |
| CLI entry | `ra/src/cli.ts` (811 lines) | Help text lists `ra`, `ra run`, `ra moa`, `ra agents`, `ra providers`, `ra models`, `ra init`, `ra doctor`, `ra selfcheck`, `ra benchmark`, `ra demo`, `ra daemon`, `ra ide`, `ra eval`, etc. There is **no `ra setup` command**. Dispatch is a chain of `if (args[0] === "…")` blocks. |
| Tests (style) | `ra/tests/tui.test.ts`, `ra/tests/tui-upgrade.test.ts`, `anubis/tests/tui.test.ts` | `tui.test.ts` covers `buildHeader` (narrow + wide), `buildInputLabel`, `footerHints`, `getTuiGlyphs` / `useAsciiGlyphs`, `renderSplashFrame` (ASCII + Unicode, several sizes), and `renderOnboardingOverlay` steps 0 and 1. Any header / splash / onboarding change must update or extend these, not delete them. |

### 3.2 First-run onboarding — exists, but it never looks for a model

- `ra/src/tui/app.ts`: `Prefs { theme?, mouse?, scrollSpeed?, onboarded?, notify? }`
  is loaded from `~/.ra/tui.json` (`TUI_PREFS`). `onboarded` is a plain
  boolean. `finishOnboarding()` sets `onboarded: true` and saves the
  theme; it is the only place that flag is written.
- After the splash, if `!onboarded`, `app.ts` opens
  `modal = { kind: "onboard", step: 0, selected: <theme index> }`.
- `ra/src/tui/overlays.ts` — `renderOnboardingOverlay({ step: 0 | 1, … })`:
  step 0 is "Step 1/2 — pick a look" (first 8 themes, `↑↓` + enter or
  click); step 1 is "Step 2/2 — what do you want to do first?" with
  three fixed actions — Build something (`/quick`), Get opinions
  (`/moa`), Just chat. There is no model step, no scan, no ping,
  no config write, and no way to re-run onboarding (the only escape
  is deleting `onboarded` from `~/.ra/tui.json` by hand).
- `ra/src/cli.ts` — `ra init` only writes `cwd/.ra/project.json`
  (`{ name, small, big, note }`) with defaults taken from the
  *current* config (`small_model ?? "ollama-lan/qwen3.8:latest"`,
  `model ?? "ollama-cloud/glm-5.2"`). It does not probe anything.
- `ra/src/doctor.ts` — `runDoctor()` only diagnoses: it prints
  `✓` / `✗` + a `→ fix` hint per check (Bun, RA home, `ra.json`,
  Ollama ping, small-model presence, usable context for the first
  5 models, Ollama Cloud key, last run). It returns exit code 0/1
  and changes nothing. There is no `ra doctor --fix` yet.

### 3.3 Discovery — exists, but is not wired into setup, and one part is unsafe to call from a UI

| Piece | Where | What exists today |
|---|---|---|
| LAN ports | `anubis/src/lan.ts` — `LAN_PORTS` | `11434 Ollama`, `1234 LM Studio`, `8080 llama.cpp`. These are the only three ports setup needs to probe. Do not add more without a reason. |
| Host probe | `anubis/src/lan.ts` — `scanHost(host, port, timeoutMs = 300)` | `GET http://<host>:<port>/v1/models`, `AbortController` timeout, returns `string[]` of model ids or `null` on any failure / non-OK. No latency, no model detail, no progress. Safe to call one host at a time. |
| Subnet scan | `anubis/src/lan.ts` — `scanSubnet(cidr, scanFn = scanHost)`, `expandSubnet` | `/24` only: expands to 254 hosts. **Do not call this from a UI as-is:** it does `Promise.all(hosts.map(...))` over 254 hosts × 3 ports = 762 concurrent fetches, with no concurrency limit, no progress callback, no per-host latency, and no cancellation. Tests in `anubis/tests/lan.test.ts` cover `expandSubnet` (254 hosts, non-/24 fallback, invalid → `[]`), `scanHost` (closed port → `null`, unreachable TEST-NET host → `null`), `buildLanConfig`, and `formatDiscovery`. |
| Config builder | `anubis/src/lan.ts` — `buildLanConfig(found)`, `formatDiscovery(found)` | `buildLanConfig` maps each found host to `providers[<provider>] = { baseURL: "http://<host>:<port>/v1", models }`. `formatDiscovery` prints `+ host:port  Name  models: …` or `"No LAN model servers found."` Both are pure and already tested — reuse them. |
| Local OpenAI servers | `anubis/src/ollama.ts` — `discoverLocalOpenAI(env, urls = [LM_STUDIO_URL ?? "http://localhost:1234", LLAMACPP_URL ?? "http://localhost:8080"])` | Probes each URL in order (1500 ms each), returns the **first** reachable `OllamaClient` with models, or `null`. Localhost only. It does not list *all* servers — setup needs the list, so use `scanHost` per target for the full picture and keep `discoverLocalOpenAI` as the fast-path fallback. |
| Endpoint picking | `anubis/src/ollama.ts` — `pickOllamaEndpoint(env)`, `pickClientForModel(configured, env, providers?)`, `smallOllamaUrls(env)` | Tries `OLLAMA_LAN_URL` then localhost (`OLLAMA_LOCAL_URL ?? "http://localhost:11434"`), 2000 ms probe each; throws `"No reachable small Ollama …"` if none answers. `pickClientForModel` falls back to `discoverLocalOpenAI` as a last resort. These are the runtime paths setup must *not* duplicate — setup writes the config they read. |
| Ping / latency | `anubis/src/ping.ts` — `pingUrl(name, url, timeoutMs = 3000)`, `pingCloud`, `pingAll`, `formatPings` | `pingUrl` uses Ollama-native `GET <base>/api/tags` (not `/v1/models`), returns `{ name, url, ok, ms, models?, notable?, error? }`. `formatPings` prints `✓/✗ name url ms (N models)` plus `RA prefer small@… → big@…`. Reuse `pingUrl` for the setup "test this model" step — do not invent a second ping. |
| Usable context | `anubis/src/context-limits.ts` — `modelMaxContextLive`, `usableContext`, `formatContext`, `contextPolicy` | Resolves a model's *usable* window (config override > live probe > static table > conservative default, clamped by `context.server_cap`). `doctor.ts` already prints it for the first 5 models. Setup must show the usable number (`formatContext(...)`), never the nominal marketing number. |
| Config | `anubis/src/config.ts` — `RaConfig`, `loadRaConfig`, `ensureRaDirs`, `loadProjectOverride`, `applyEnvOverrides`; `anubis/ra.json` (shipped example) | `RaConfig` has `model` (big), `small_model`, `provider: Record<string, …>`, `capability_router`, `routing.mode` (`local-first` default), `context.server_cap`, `profiles`, `agent.<role>.model`. Shipped `ra.json`: `model: "ollama-cloud/glm-5.2"`, `small_model: "ollama-lan/qwen3:4b"`, profile `mac-weak`. **There is no `saveRaConfig` function anywhere in the repo** (checked: `loadRaConfig` only, and it throws if neither `ra.json` nor legacy `anubis.json` exists). Setup must add a save path — see §5.5. Env overrides: `RA_MODEL` / `ANUBIS_MODEL` → big, `RA_SMALL_MODEL` / `ANUBIS_SMALL_MODEL` → small. |
| Existing LAN entry points | `ra/src/commands/index.ts:343` (`/lan-scan`), `anubis/.anubis/plugins/lan.ts` | `/lan-scan` hardcodes `scanSubnet("192.168.1.0/24")` and replies with `formatDiscovery(found)`. It is a hidden command, not a setup step, and it hardcodes the subnet. Setup must derive the subnet from the machine's own interfaces (see §5.3) and never hardcode `192.168.1.0/24`. |

### 3.4 What is missing (the whole job)

1. No `ra setup` command, no `ra doctor --fix`, no `ra setup --rescan`.
2. No model-discovery step in first-run onboarding, and no way to
   re-run onboarding.
3. No bounded / progress-reporting LAN scan (current `scanSubnet`
   is all-at-once, silent, and un-cancellable).
4. No config-save function (`saveRaConfig`).
5. No header / splash / status-bar signal for lane, cost, or
   context pressure — the user cannot see, at a glance, whether
   RA has a model at all.
6. No shared "status line" vocabulary for scan states
   (`scanning / found / not found / skipped / failed`) — each
   surface invents its own `✓` / `✗` / `○` today.

---

## 4. Design spec (a) — stylish CLI

**Goal:** the same RA, visibly more considered. A new user should be
able to tell, in the first three seconds, what RA is, whether it has
a model, and what to do next — without reading a manual. A returning
user should get the same information in the header on every screen.

**Non-goals:** no new dependencies, no new native modules, no
rebrand, no change to the agent loop, no change to keybindings,
no change to the palette's search behaviour, no animation that
blocks input or delays model output.

### 4.1 Design tokens (single source of truth)

- All colours come from `anubis/src/ui.ts` — `getPalette(name)` /
  `listPalettes()`. Do not hardcode a hex colour in any TUI file.
  The default palette stays `pharaonic` (accent `#fbbf24`,
  success `#84cc16`, warning `#eab308`, error `#ef4444`).
- Add one new export to `anubis/src/ui.ts` if needed and nothing
  else: a `StatusKind = "ok" | "warn" | "error" | "info" | "busy"`
  → palette-colour mapping, so header, splash, setup, and doctor
  all use the same colour for the same meaning. Keep it pure and
  unit-tested.
- Box style: keep `formatBox` (`rounded` default) and the
  `╭─╮ / │ / ╰─╯` boxes in `ra/src/tui/overlays.ts`. New boxes
  must use the same helper / the same characters. No double-line
  boxes for normal content (reserve `double` for the splash
  title only, if at all).

### 4.2 Header + status bar (`ra/src/tui/chrome.ts`, `ra/src/tui/app.ts`)

Extend `buildHeader` — do not replace it. Keep its three width
breakpoints (`<68`, `<108`, `>=108`) and its existing tests passing.

- New optional fields on the `buildHeader` opts (all optional,
  all with safe defaults so existing callers and tests keep
  working): `lane?: string` (e.g. `small@lan · big@cloud`),
  `costUsd?: number`, `contextPct?: number` (0–100, from the
  agent token ledger in `ra/src/agent.ts` — read-only, no new
  coupling; if no ledger is available, omit it), `setupNeeded?: boolean`.
- Wide (`>=108`): `𓂀 RA 26856.9 · default · small qwen3:4b · big glm-5.2 · small@lan → big@cloud · $0.04 · ctx 42%`
  — truncate each model with the existing `shortModel()` (24 chars
  wide, 16 chars in the `<108` branch). If `setupNeeded` is true,
  replace the lane segment with `⚠ no model — run ra setup`
  in the warning colour (ASCII: `! no model — run ra setup`).
- Medium (`<108`): keep `S:` / `B:` short models, add the lane
  only if it fits: `S:qwen3:4b · B:glm-5.2 · small@lan`.
- Narrow (`<68`): keep brand + version + profile only, plus a
  single status glyph: `◉` busy, `▲` setup needed / warning,
  `○` idle. Never wrap the header. Never let it exceed the
  terminal width — truncate with the existing `truncateVisible`
  helper from `ra/src/tui/markdown.ts`.
- Context pressure: `0–69%` muted, `70–89%` warning colour with
  the existing low-watermark meaning (70% = wrap-up, from
  `anubis/src/context-limits.ts` / `ra/src/agent.ts`), `90–100%`
  error colour (90% = checkpoint + handoff). Show the number
  only when a run is active; otherwise omit it — an empty header
  is better than a stale `ctx 0%`.
- Add a second, thin status line directly under the header in
  `app.ts` (rendered by a new pure helper in `chrome.ts`,
  e.g. `buildStatusLine({ cwd, branch, theme, lane, costUsd })`):
  the existing `workspaceLabel` content (`cwd · ⑂ branch · theme`)
  plus, when available, `· small@lan → big@cloud`. Keep it one
  line, muted colour, truncated to width. In ASCII mode the
  branch glyph is the existing `git` text from `ASCII_GLYPHS`.

### 4.3 Spinner, progress, and message states (`ra/src/tui/app.ts`, `ra/src/tui/chrome.ts`)

- Keep the existing `SPINNER` frames (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`) in
  `app.ts`. Add one pure helper in `chrome.ts`:
  `spinnerFrame(frame: number): string` (ASCII: cycle `| / - \`).
  The TUI already has a `spinnerFrame` counter — reuse it; do not
  add a second timer.
- Every long operation (scan, model probe, MoA fan-out, swarm)
  must show, on one line: spinner + verb + target + elapsed
  (`⠋ Scanning 192.168.1.0/24 … 12/254 hosts · 3 found · 2.1s`).
  No silent waits longer than 300 ms. When an operation finishes,
  replace the spinner line with a one-line result
  (`✓ Found 3 servers · 5 models · 2.4s` / `✗ No servers found —
  see ra setup`) and keep it visible until the next turn.
- Standardise message prefixes (new pure helpers in `chrome.ts`,
  tested in `ra/tests/tui.test.ts`): `✓` success (success colour),
  `▲` / `!` warning, `✗` / `x` error, `·` / `-` info, `◉` / `*`
  busy. ASCII mapping must be the existing `ASCII_GLYPHS` set —
  do not invent new ASCII glyphs. Streaming keeps the existing
  `▌` / `|` marker. Do not change the `›` user / `◆` assistant
  markers.

### 4.4 Palette, input, and footer (`ra/src/tui/palette.ts`, `ra/src/tui/app.ts`, `ra/src/tui/chrome.ts`)

- Keep the unified `/` palette and its fuzzy matching exactly
  as-is. Add, do not remove: a `setup:` group at the top of the
  palette when `setupNeeded` is true, with entries
  `setup: run model setup`, `setup: rescan local servers`,
  `setup: change small model`, `setup: change big model`.
  Each entry runs the corresponding `ra setup` flow (see §5).
- `buildInputLabel`: keep the existing idle label
  (`𓂀 RA ╼ / search · ? shortcuts`) and busy label. When
  `setupNeeded`, append `· no model` in warning colour to the
  idle label only — never to the busy label, and never as a
  blocking modal.
- `footerHints`: keep the five existing hints
  (`/ search`, `ctrl+p palette`, `? keys`, `esc close/cancel`,
  `ctrl+d quit`). Add no more than one new hint, and only in
  the setup wizard itself (see §5.4), not in the main footer.

### 4.5 Splash refresh (`ra/src/tui/splash.ts`, `ra/src/tui/app.ts`)

- Keep `renderSplashFrame`, `LOGO` / `ASCII_LOGO`, `TAGLINE`,
  the 1600 ms timeout, any-key-skips, and `RA_NO_SPLASH=1`.
  Do not make the splash slower.
- Add two lines under the version line, centred, muted, using
  the existing `composite()` helper: line 1 is the lane or the
  setup call-to-action (`small@lan → big@cloud` when a lane
  exists, otherwise `no model yet — run ra setup after this
  screen`); line 2 is the single most useful next command
  (`ra setup` on first run, `ra again --quick --verify` when a
  last run exists — reuse `loadLastRun()` from
  `anubis/src/last-run.ts`, which `doctor.ts` already uses).
- On narrow terminals (`width < 68`) omit line 2. On ASCII
  terminals use `ASCII_LOGO` and the existing `ASCII_TILE`
  only. Never let the splash write past the terminal height —
  the existing clip guard (`if (rowIndex < 0 || rowIndex >= H)
  continue`) stays.

### 4.6 What "stylish" must NOT do

- No emoji. The only glyphs are the ones in `chrome.ts`
  (`𓂀 › ◆ ▲ · ▌ ◉ ○ ⑂ ╼`) plus box-drawing (`╭─╮│╰─╯`).
- No true-colour escapes outside the palette. No background
  fills except the existing `bar` style in overlays.
- No animation loop. The splash is a static frame; the spinner
  is the only moving element, and it must never delay input
  or model output.
- No change to `ra/src/tui/legacy.ts` behaviour except the
  shared helpers above — the readline fallback must keep
  working when there is no TTY.

### 4.7 File-by-file tasks — CLI style

| # | File | Change |
|---|---|---|
| S1 | `anubis/src/ui.ts` | Add `StatusKind` → palette-colour mapping (pure, tested). No other change. |
| S2 | `ra/src/tui/chrome.ts` | Extend `buildHeader` opts (`lane?`, `costUsd?`, `contextPct?`, `setupNeeded?`); add `buildStatusLine`, `spinnerFrame`, and the standardised `✓/▲/✗/·/◉` prefix helpers. Keep all existing exports and their signatures backward-compatible. |
| S3 | `ra/src/tui/app.ts` | Wire the new header/status-line fields from the existing config + last-run + cost ledger; show the spinner + elapsed line for long operations; add the `setup:` palette group when `setupNeeded`. Do not change key handling. |
| S4 | `ra/src/tui/splash.ts` | Add the two centred muted lines under the version line (lane / next command), with the narrow + ASCII guards in §4.5. Keep `renderSplashFrame` signature backward-compatible (new fields optional). |
| S5 | `ra/src/tui/overlays.ts` | No visual change except the onboarding steps in §5.4 (new step). Keep `renderMenuOverlay` and `renderShortcutsOverlay` untouched. |
| S6 | `ra/tests/tui.test.ts`, `ra/tests/tui-upgrade.test.ts` | Extend: header at 60 / 80 / 120 cols with and without lane/cost/context/setupNeeded; status line truncation; spinner frames (Unicode + ASCII); splash lines at narrow width and in ASCII mode. Keep every existing test passing. |

---

## 5. Design spec (b) — initial setup / Model Designer

**Goal:** the first time a person runs RA, they *see* RA looking
for models, they *see* what it found, and they *choose* — in under
a minute when a local server is already running, and with a clear
next step when nothing is found. Setup is not a README paragraph;
it is a command and a wizard step that does the work.

### 5.1 Commands (new, in `ra/src/cli.ts`)

Add these dispatch branches next to the existing `doctor` /
`init` branches (same style — a plain `if (args[0] === "…")`
block, `process.exit(...)` at the end). Do not refactor the
existing dispatch chain.

```
ra setup [--rescan] [--no-lan] [--json]
  Run the interactive first-run setup. Re-runnable any time.
  --rescan  forget the saved small/big choice and scan again.
  --no-lan  localhost only; skip the LAN /24 scan.
  --json    machine-readable result (found hosts, chosen
            models, config path, exit code); no TUI, no splash.

ra setup --check
  Non-interactive: scan localhost only, print the result in
  the doctor style (✓/✗ + one-line fix), exit 0 if a small
  model is reachable, 1 otherwise. For CI / scripts.

ra doctor --fix
  Run the existing doctor checks, then, for each failing
  model check, offer (headless: attempt) the fix from §5.5:
  probe local servers, write the working endpoint to config,
  re-run doctor once, and print the before/after. Never
  silently change a config that already has a working lane.
```

Also wire the TUI: `/setup` in the palette and the `setup:`
group in §4.4 must call the same setup flow as `ra setup`
(shared function, not a copy). `ra init` stays as-is (it only
writes `.ra/project.json`); setup is the user-level equivalent
that writes the *global* config.

### 5.2 Where setup lives (new files, small and named)

| File | Contents |
|---|---|
| `anubis/src/setup.ts` (new, pure + IO, testable) | The setup engine, no TUI in it: `SetupTarget`, `SetupFound`, `SetupChoice`, `scanLocalTargets()` (localhost phase), `scanLanTargets(subnet, onProgress)` (bounded LAN phase), `pickDefaults(found)`, `saveSetupChoice(choice)` (see §5.5), `setupSummary(found, choice)`. All network access goes through the existing `scanHost` / `pingUrl` / `discoverLocalOpenAI` — setup adds orchestration, timeouts, and progress, not a new prober. |
| `ra/src/setup.ts` (new, CLI/TUI glue) | `runSetup({ rescan, noLan, json, check })`: parses flags, derives the subnet, drives `anubis/src/setup.ts` with a progress callback, prints the headless output, and (interactive only) hands the result to the wizard in `ra/src/tui/overlays.ts`. No model logic here — only flags, printing, and exit codes. |
| `ra/src/tui/overlays.ts` (extend) | `renderSetupOverlay` — the wizard step (see §5.4). Pure renderer, same pattern as `renderOnboardingOverlay`: lines + hitboxes out, no network, no config writes. |
| `ra/src/tui/app.ts` (extend) | Insert the setup step into the first-run flow (see §5.4) and wire `/setup` + the `setup:` palette group to `runSetup`. |
| `ra/src/cli.ts` (extend) | The three dispatch branches in §5.1 + help-text lines for `ra setup` / `ra doctor --fix`. |
| `ra/src/doctor.ts` (extend) | `runDoctor({ fix?: boolean })`: keep every existing check byte-for-byte when `fix` is false; when true, attempt the fixes in §5.5 and re-run once. |
| `anubis/src/config.ts` (extend) | Add `saveRaConfig(cfg, root?)` (see §5.5). No other change. |
| `anubis/src/lan.ts` (extend) | Add `scanSubnetBounded(cidr, { concurrency, timeoutMs, onProgress })` (see §5.3). Keep `scanSubnet` untouched (it is tested and used by `/lan-scan` and the lan plugin) — mark it in a comment as "not for UI use; use scanSubnetBounded". |
| `anubis/tests/setup.test.ts`, `ra/tests/setup.test.ts` (new) | Tests in §6. |

### 5.3 Active discovery — what is scanned, in what order, with what limits

The scan is *visible*: every target is printed as it is probed,
with a live count. The user must never stare at a blank screen
while RA scans. Order matters — cheapest and most likely first,
so the common case finishes in ~1 second.

**Phase 0 — localhost, always, no permission needed (loopback only).**
Probe, in parallel, these four targets (all `GET /v1/models`,
`scanHost`, 300 ms timeout each, plus a latency measurement —
see the sketch below):

| # | Target | Port | How |
|---|---|---|---|
| L1 | Ollama, localhost | 11434 | `scanHost("127.0.0.1", 11434, 300)` — plus `pingUrl("local", "http://localhost:11434")` for latency + `/api/tags` model list when `/v1/models` is empty |
| L2 | LM Studio, localhost | 1234 | `scanHost("127.0.0.1", 1234, 300)` |
| L3 | llama.cpp, localhost | 8080 | `scanHost("127.0.0.1", 8080, 300)` |
| L4 | Configured LAN URL, if set | `OLLAMA_LAN_URL` (or `OLLAMA_LOCAL_URL` if different) | `scanHost(host, port, 300)` for the host/port parsed from the env URL — never hardcode a host |

Print each target as it starts (`⠋ localhost:11434 Ollama …`)
and as it resolves (`✓ localhost:11434 Ollama · 4 models · 12ms`
or `· not running`). If any Phase 0 target returns models,
Phase 1 is offered, not forced — see below.

**Phase 1 — LAN, explicit opt-in, cancellable.**
LAN scanning touches other machines, so it is *not* silent and
*not* default-on in the headless path. In the interactive wizard
it is a single explicit choice ("Scan my local network for AI
servers? [Yes / No]"), defaulting to Yes when a localhost
server was *not* found, and to No when one *was* found (the
user can still say Yes). In `ra setup --json` / `--check`,
LAN is skipped unless `--lan` is passed. `Esc` / `Ctrl+C`
cancels the scan at the next host batch and keeps whatever was
found so far — a cancelled scan is a partial result, not an
error.

- Derive the subnet from the machine's own interfaces (Node
  `node:os` `networkInterfaces()`, first non-internal IPv4
  interface, `/24`). Never hardcode `192.168.1.0/24`. If no
  interface is found, skip LAN with the message
  `No local network interface found — LAN scan skipped.`
  and continue.
- Bounded scan — new `scanSubnetBounded` in `anubis/src/lan.ts`:

```ts
// anubis/src/lan.ts — add, do not replace scanSubnet.
export interface ScanProgress {
  probed: number; total: number; found: number; elapsedMs: number;
  currentHost: string;
}
export async function scanSubnetBounded(
  cidr: string,
  opts: {
    concurrency?: number;      // default 32
    timeoutMs?: number;        // default 300 — same as scanHost
    onProgress?: (p: ScanProgress) => void;
    signal?: AbortSignal;      // Esc / Ctrl+C
    scanFn?: typeof scanHost;
  } = {},
): Promise<DiscoveredHost[]> {
  // 254 hosts × LAN_PORTS, in batches of `concurrency`.
  // Call onProgress after every batch (and at least every 200 ms).
  // Return every host with models.length > 0, in first-found order.
  // Never throw for a single host failure — a dead host is a null,
  // not an error. Throw only for an invalid CIDR.
}
```

  With concurrency 32 and a 300 ms timeout, a full /24 is
  ~762 probes in ~8 batches — worst case ~3 s of probe time
  plus overhead; budget the whole LAN phase at 10 s and stop
  with what was found if the budget is exceeded. Show the
  live line from §4.3 throughout:
  `⠋ Scanning 192.168.1.0/24 … 96/254 hosts · 2 found · 1.8s`
  (update at most every 200 ms so the terminal does not flood).

**Phase 2 — cloud, only if the user asks.**
If no local server was found, offer — do not assume — the
cloud path: "No local server found. Use Ollama Cloud (needs
`OLLAMA_API_KEY`) or another cloud provider? [Cloud / Manual
URL / Skip for now]". Cloud is never probed without a key
already present in the environment. If `OLLAMA_API_KEY` is
set, `pingCloud` (from `anubis/src/ping.ts`, 5000 ms) is the
probe. A manual URL is validated with `scanHost` before it
is saved.

**Per-host result — what is shown for each found server.**
For every found host, show: `host:port`, provider name
(`Ollama` / `LM Studio` / `llama.cpp`), latency in ms
(measured around the `scanHost` call — `scanHost` itself
returns no latency, so wrap it: `t0 = Date.now(); models =
await scanHost(...); ms = Date.now() - t0`), model list
(truncated to 4, with `+N more`), and usable context for the
first model (via `modelMaxContextLive` + `usableContext` +
`formatContext` from `anubis/src/context-limits.ts` — the
same call `doctor.ts` already makes). Never show the nominal
context number on its own. Example line:

```
✓ 192.168.1.50:11434  Ollama     14ms  qwen3:4b, gemma:latest +2 more  · ctx 32K usable
✓ localhost:1234       LM Studio  8ms   gpt-oss:20b                    · ctx 8K usable
```

### 5.4 First-run wizard — the visible flow

Insert setup as the **first** onboarding step, before the theme
step. Renumber the wizard to three steps (the existing
`renderOnboardingOverlay` `step: 0 | 1` becomes `step: 0 | 1 | 2`):

| Step | Title | What the user sees / does |
|---|---|---|
| 1/3 — Models | `Welcome to RA — let's find your models` | A live scan panel (see below). Runs Phase 0 automatically on entry. Phase 1 (LAN) is one explicit Yes/No. Phase 2 (cloud/manual) only if nothing was found. Then a pick list: small model (detector) and big model (fixer), each defaulting to the best-scoring found model for that lane (see §5.5). `↑↓` + enter or click to pick, `s` to skip, `esc` to skip the whole setup (RA still opens, with `setupNeeded` true in the header — see §4.2). |
| 2/3 — Look | Existing theme step, unchanged | "Step 2/3 — pick a look". Keep the 8-theme list and the existing hitbox behaviour. |
| 3/3 — First move | Existing first-action step, unchanged | "Step 3/3 — what do you want to do first?" Keep the three actions. |

The scan panel is a new pure renderer,
`renderSetupOverlay({ screenW, screenH, style, phase, targets, found, selectedSmall, selectedBig, version })`,
in `ra/src/tui/overlays.ts`, following the exact pattern of
`renderOnboardingOverlay` (centred box, `boxW = min(W-4, 72)`,
`pad()` helper, `▌` selected marker, `themeHit` /
`actionHit`-style hitboxes for clicks). It must render from
state only — no network, no config writes inside the renderer.
Live updates come from `app.ts` re-rendering on each
`onProgress` callback (throttled to 200 ms, §5.3).

State machine for the wizard (implement in `app.ts`, not in
the renderer):

```
idle → scanning-local → (found? pick : ask-lan)
  → scanning-lan → (found? pick : ask-cloud/manual/skip)
  → picking-small → picking-big → testing (ping both)
  → saving → done → theme step
Any state → esc/s → skipped (setupNeeded = true, wizard
  continues to the theme step; nothing is saved)
```

- **Testing:** before saving, `pingUrl` each chosen model
  host (3000 ms timeout, from `anubis/src/ping.ts`). If a
  ping fails, show the error in place (`✗ host unreachable —
  pick another model or skip`) and stay on the pick step.
  Do not save a choice that just failed its ping.
- **Skipping is first-class:** `s` skips the current step,
  `esc` skips all of setup. A skipped setup is not an error,
  and it must be re-runnable (`ra setup`, `/setup`, palette
  `setup:` group). `finishOnboarding()` must not set
  `onboarded: true` until the theme step is done — setup
  being skipped does not block the rest of onboarding.
- **Headless parity:** `ra setup --json` prints the same
  result object the wizard saves (see §5.5), with no splash,
  no TUI, and no prompt. `ra setup --check` prints the
  doctor-style lines and exits 0/1. Both must work on a
  machine with no TTY.

### 5.5 Picking defaults + saving (the part that must not lose data)

**Defaults — how the "best" small / big are chosen, in order:**

1. If the user already has a working lane in `ra.json`
   (`small_model` / `model` that pings OK), keep it — setup
   must never silently overwrite a working choice. Show it
   as `current: …` and pre-select it.
2. Otherwise, small (detector) = the first found model whose
   family matches a known small family (`qwen3`, `gemma`,
   `flint`, `gpt-oss` — reuse `profileNotableRegex` from
   `anubis/src/ping.ts` and the `capability_router` allowlist
   in `anubis/ra.json` if present), preferring localhost
   over LAN, and preferring the model with the largest
   *usable* context that is still ≤ 32K (small models do not
   need a huge window; the low-context runtime in
   `ra/src/agent.ts` checkpoints at 70% / 90% — see the KING
   plan §2). If none matches, pre-select the first found
   model and let the user change it.
3. Big (fixer) = the first found cloud model if a cloud key
   is present, otherwise the largest-context found local
   model. If no big model exists at all, big stays unset
   (`model` is left as-is in config, and the header shows
   `big@—` / `big@down` — it is not an error, it is a
   local-only setup).
4. Hermes note: do not hardcode Hermes model names here.
   The lanes are generic (`small_model`, `model`); the
   Hermes assistant (KING plan §6) reads the same lanes.
   A future `hermes-4` lane, if added, is a config value,
   not a setup special case.

**Saving — add `saveRaConfig`, do not invent a second format:**

```ts
// anubis/src/config.ts — add, alongside loadRaConfig.
export function saveRaConfig(cfg: RaConfig, root = RA_HOME): string {
  // Resolve the path exactly as loadRaConfig does:
  //   process.env.RA_CONFIG ?? join(root, "ra.json")
  //   (fall back to legacy anubis.json only if ra.json does not
  //   exist AND anubis.json does — same rule as loadRaConfig).
  // mkdir -p the parent, write JSON.stringify(cfg, null, 2) + "\n"
  // atomically (write to <path>.tmp, then rename), and return
  // the path written. Never write apiKey values: strip any
  // provider.options.apiKey that is not a "{env:VAR}" template
  // before writing, and throw (do not save) if a non-template
  // key would be written.
}
```

- Setup writes, in one `saveRaConfig` call: `small_model`
  (`<provider>/<model>`, e.g. `ollama-lan/qwen3:4b`),
  `model` (big, same format, only if chosen), `provider`
  entries for every found host (via the existing
  `buildLanConfig(found)` — merge, do not replace, the
  existing `provider` block), and `routing.mode`
  (unchanged unless the user picked it — default
  `local-first` stays).
- Cloud keys: if the user typed a key in the wizard, write
  it to `<RA_HOME>/.env` as `OLLAMA_API_KEY=<key>` (append
  if the file exists, create it if not, mode `0600`),
  and write only `{env:OLLAMA_API_KEY}` into `ra.json`.
  Never print the key. Never commit `.env` (it is already
  git-ignored — verify, do not assume).
- After saving, print the saved summary and re-run the
  doctor checks for the two chosen hosts only (not the
  whole doctor), so the user sees `✓ small reachable` /
  `✓ big reachable` before the wizard closes.
- The result object (also the `--json` output):

```json
{
  "ok": true,
  "configPath": "RA_HOME/ra.json",
  "small": "ollama-lan/qwen3:4b",
  "big": "ollama-cloud/glm-5.2",
  "found": [
    { "host": "127.0.0.1", "port": 11434, "provider": "ollama-lan",
      "name": "Ollama", "models": ["qwen3:4b"], "ms": 12 }
  ],
  "skipped": false
}
```

### 5.6 What setup must NOT do

- Do not scan the LAN without the explicit Yes in §5.3
  (interactive) or `--lan` (headless). Localhost needs no
  permission; the LAN is other people's machines.
- Do not `ollama pull` a model without asking. If a server
  is up but has zero models, say so
  (`✓ localhost:11434 Ollama · 0 models — run ollama pull qwen3:4b`)
  and offer a one-key `pull` action in the wizard — the
  pull itself is a separate, explicit user action, and it
  is out of scope for this brief if it needs new code
  (file it as a follow-up, do not block setup on it).
- Do not change `ra run`, `ra moa`, routing, or the agent
  loop. Setup only writes config; the runtime reads it.
- Do not store the scan result in git. The scan is
  machine-specific (host IPs, model lists). Only the
  *code* and this brief are committed.

### 5.7 File-by-file tasks — setup

| # | File | Change |
|---|---|---|
| U1 | `anubis/src/lan.ts` | Add `scanSubnetBounded` + `ScanProgress` (§5.3). Keep `scanSubnet`, `scanHost`, `buildLanConfig`, `formatDiscovery` untouched. |
| U2 | `anubis/src/config.ts` | Add `saveRaConfig` (§5.5) with the no-plaintext-key guard. No other change. |
| U3 | `anubis/src/setup.ts` (new) | Setup engine: `scanLocalTargets`, `scanLanTargets`, `pickDefaults`, `saveSetupChoice`, `setupSummary`. No TUI, no `process.exit`. All network via `scanHost` / `pingUrl` / `discoverLocalOpenAI`. |
| U4 | `ra/src/setup.ts` (new) | CLI glue: `runSetup({ rescan, noLan, json, check })`, flag parsing, subnet derivation, progress printing, exit codes. |
| U5 | `ra/src/cli.ts` | Add `ra setup [--rescan] [--no-lan] [--json]`, `ra setup --check`, `ra doctor --fix` dispatch + help lines. |
| U6 | `ra/src/doctor.ts` | `runDoctor({ fix?: boolean })`; fix path = probe + save + re-run once (§5.1, §5.5). |
| U7 | `ra/src/tui/overlays.ts` | Add `renderSetupOverlay` (pure, §5.4); extend `renderOnboardingOverlay` step type `0 \| 1` → `0 \| 1 \| 2` and renumber the titles to 1/3, 2/3, 3/3. Keep the theme + action steps visually unchanged. |
| U8 | `ra/src/tui/app.ts` | Insert the setup step first in the first-run flow; wire `/setup` + `setup:` palette group; throttle scan re-renders to 200 ms; keep `finishOnboarding` semantics (§5.4). |
| U9 | `anubis/tests/setup.test.ts`, `ra/tests/setup.test.ts` (new) | Tests in §6. |

---

## 6. Acceptance criteria + tests

### 6.1 Acceptance (all must pass before the branch is merged)

**Style**
- [ ] Header shows lane + cost + context pressure at `>=108` cols,
  short models at `<108`, brand-only + one status glyph at `<68`,
  with no wrapping or overflow at 60 / 80 / 120 cols.
- [ ] `RA_ASCII=1 ra` and `TERM=dumb ra` produce no Unicode glyph,
  no emoji, and no true-colour escape in the header, splash,
  setup, or footer. (Check with `RA_ASCII=1 ra --version` +
  a TUI smoke run and by grepping the rendered lines in tests.)
- [ ] Splash still renders in < 1600 ms, any key still skips it,
  `RA_NO_SPLASH=1` still skips it.
- [ ] Palette search, `?` shortcuts, mouse, and all existing
  keybindings behave exactly as before.

**Setup**
- [ ] Fresh machine, no model: `ra setup` shows the scan live,
  finds nothing, offers cloud / manual / skip, and exits
  cleanly with `setupNeeded` visible in the next `ra` header.
- [ ] Ollama-only (localhost:11434): `ra setup` finishes in
  < 10 s, lists the models with latency + usable context,
  pre-selects a sensible small model, pings it, writes
  `ra.json`, and the next `ra doctor` is green for the small lane.
- [ ] LM Studio-only (localhost:1234): same as above, with the
  LM Studio host correctly labelled and its models listed.
- [ ] LAN case: with a server on the LAN, `ra setup` (interactive,
  LAN = Yes) finds it, shows `host:port`, and saves it via
  `buildLanConfig`. With `--no-lan`, it does not touch the LAN.
- [ ] Re-run: `ra setup --rescan` forgets the saved choice and
  scans again; `ra setup` without `--rescan` keeps a working
  lane and pre-selects it.
- [ ] `ra doctor --fix` on a machine with a running Ollama
  but a stale `ra.json` fixes the config and re-runs doctor
  green. On a machine with no server at all, it prints the
  fix it *would* apply and exits 1 — it does not invent a
  server.
- [ ] No secret is written to `ra.json` or printed. `grep -r`
  for the test key in the repo after a setup run returns
  nothing in tracked files.
- [ ] `ra setup --json` on a machine with no TTY prints valid
  JSON and exits 0/1 as specified in §5.1.

**Regression**
- [ ] `bun test` (full suite: Anubis + RA) passes. Known
  baseline at commit `0f0ad0a`: Anubis 236 pass / 0 fail,
  RA 275 pass / 7 fail (6 = missing `bubblewrap`, 1 = brittle
  REPOMAP test) — see the KING plan §1 and the saved status
  in §0, re-verified fresh 2026-11-09 04:14 UTC with the
  same numbers. This brief does not fix those; it must not
  make them worse.
- [ ] `bash scripts/verify-release.sh` passes (or fails only
  for the pre-existing reasons documented in the KING plan).
- [ ] `README.md` Quick-start shows `ra setup` before `ra`.

### 6.2 Tests to add (do not ship without these)

| Test file | Cases |
|---|---|
| `anubis/tests/setup.test.ts` (new) | `scanLocalTargets` with a fake `scanHost` (Ollama found, LM Studio down, llama.cpp down) returns the found list in order; `scanSubnetBounded` with a fake scanner respects the concurrency limit, calls `onProgress`, returns found hosts in first-found order, and honours `AbortSignal`; invalid CIDR throws; `pickDefaults` keeps a working existing lane, otherwise picks a small family model over an unknown one, and leaves big unset when no cloud model exists; `saveSetupChoice` refuses a plaintext API key and writes `{env:VAR}` only. |
| `ra/tests/setup.test.ts` (new) | `runSetup --json` with fake discovery prints valid JSON with `ok`, `configPath`, `small`, `found`; `--check` exits 0 when a small model is reachable and 1 when not; `--rescan` ignores the saved choice. Use injected fakes for all network calls — no test may depend on a real Ollama / LM Studio server. |
| `ra/tests/tui.test.ts` (extend) | `buildHeader` at widths 60 / 80 / 120 with lane + cost + context + `setupNeeded` (each field present and absent); `buildStatusLine` truncation at 60 cols; `spinnerFrame` in Unicode and ASCII; `renderSetupOverlay` renders the scanning / found / picking states and its hitboxes; `renderOnboardingOverlay` step 2 (renumbered) still renders the theme step and step 3 the action step. |
| `anubis/tests/lan.test.ts` (extend) | `scanSubnetBounded` only — do not change the existing `scanSubnet` / `scanHost` / `buildLanConfig` / `formatDiscovery` tests. |
| Manual checklist (not automated, do it once) | Clean Ubuntu 24.04 container + macOS, each: no model, Ollama-only, LM Studio-only, LAN server present. ASCII mode on each. Note the wall-clock time for `ra setup` in each case in the PR description. |

---

## 7. Git steps — push this cleanly

Run these from the repo root, on a fresh branch. Do not commit
anything the scan or the setup wrote to your home directory.

```bash
# 1. Put this brief in the repo (this file, renamed)
cp ~/workspace/RA-cli-setup-cursor.md docs/CURSOR-RA-CLI-SETUP.md
#    — if you received this file by another path, copy from there
#      instead; the destination in the repo is always
#      docs/CURSOR-RA-CLI-SETUP.md

# 2. Check what is actually changed — only code + this doc + tests
git status --short
git diff --stat

# 3. Make sure no secret, env file, or machine-specific file is staged
git status --short | grep -E '\.env|ra\.json|\.ra/' || true
#    ra.json in anubis/ is a shipped example — it is tracked, but
#    do not commit a machine-specific edit to it. If setup wrote
#    to ~/.ra/ra.json, that file is NOT in the repo; leave it alone.
#    Never `git add .env` or `git add ~/.ra`.

# 4. Commit (one commit for the brief, one per feature is fine too)
git add docs/CURSOR-RA-CLI-SETUP.md ra/src/tui/chrome.ts ra/src/tui/splash.ts \
  ra/src/tui/app.ts ra/src/tui/overlays.ts ra/src/cli.ts ra/src/doctor.ts \
  ra/src/setup.ts anubis/src/setup.ts anubis/src/lan.ts anubis/src/config.ts \
  anubis/tests/setup.test.ts ra/tests/setup.test.ts ra/tests/tui.test.ts \
  README.md
git commit -m "feat(cli): stylish header/splash + ra setup with local AI discovery

- Header/status bar show lane, cost and context pressure; ASCII
  fallback kept (RA_ASCII=1 / TERM=dumb).
- New ra setup wizard: live localhost scan (Ollama 11434, LM Studio
  1234, llama.cpp 8080), opt-in bounded LAN /24 scan, pick small/big,
  ping-test, save ra.json via saveRaConfig (keys stay in .env).
- ra doctor --fix, ra setup --rescan / --json / --check.
- See docs/CURSOR-RA-CLI-SETUP.md for the full spec and tests."

# 5. Push
git push -u origin <your-branch-name>
#    Then open the pull request. In the PR description, paste the
#    manual-checklist times from §6.2 and the bun test + verify-release
#    results. Do not paste any API key or .env content.
```

**What NOT to commit:** `.env`, `~/.ra/` (home config, including
`~/.ra/ra.json`, `~/.ra/tui.json`, `~/.ra/sessions/`,
`~/.ra/handoffs/`), any `*.log`, `node_modules/`, `dist/`,
`build/`, coverage output, or the scan output itself (host IPs
and model lists are machine-specific). If `git status` shows
any of those, do not `git add` them — check `.gitignore` first.

---

## 8. Open questions for Nicholas (decide before, or during, the Cursor run)

1. **LAN scan — opt-in or opt-out?** This brief makes LAN
   opt-in (explicit Yes, default Yes only when no localhost
   server was found). If you want it always-on and automatic,
   say so and Cursor should flip the default in §5.3 — the
   bounded scan and the 10 s budget stay the same either way.
2. **Default theme — keep `pharaonic`?** This brief keeps
   gold/papyrus as the default. If you want a different
   default (e.g. `obsidian` or `nord`), say the palette name
   and Cursor should change only `DEFAULT_UI_CONFIG` in
   `anubis/src/ui.ts` and the onboarding default selection.
3. **Cloud in setup — Ollama Cloud only, or any provider?**
   This brief offers Ollama Cloud when a key exists and a
   manual URL otherwise. If you want a named cloud provider
   list in the wizard (Anthropic / OpenAI / Z.ai, from the
   existing `provider` block in `anubis/ra.json`), say so —
   it is a small addition to §5.3 Phase 2, but it changes
   the key-handling in §5.5.
4. **Should `ra setup` also install `bubblewrap` / run `ollama pull`?**
   Out of scope for this brief on purpose (see §5.6 and the
   KING plan Phase 0.1 / 0.5). If you want them in the same
   PR, say so and they should be separate, explicit, opt-in
   steps — not silent side effects of setup.

*End of brief. Source of truth for the wider RA plan is
`RA-king-plan.md` (§1 test results, §6 Hermes — confirmed:
assistant, not model; flexible Ollama / cloud models; local
detector → bigger fixer via MoA). This file covers CLI style
+ setup only, so it can land on its own, before any of that.*
