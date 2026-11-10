---
name: game-studio
description: Runs game development using the Claude Code Game Studios (CCGS) methodology — a phased studio pipeline (Concept, Systems Design, Technical Setup, Pre-Production, Production, Polish, Release) with a fast minimal path, rigor modes, GDD/story artifacts, and role-based quality gates. Use when starting, designing, building, reviewing, or shipping a video game, or when the user mentions game dev, GDDs, game design docs, game epics or stories, playtesting, vertical slices, or Godot/Unity/Unreal work.
---

# Game Studio (CCGS methodology)

Methodology distilled from [Claude Code Game Studios](https://github.com/Donchitos/Claude-Code-Game-Studios): give an AI coding session the structure of a real studio — directors guard the vision, leads own domains, specialists do the work, and nothing is "done" unverified.

**If the project already contains CCGS** (`project.yaml` with `schema_version`/`framework`, or `.claude/skills/` defining commands like `/dev-story`): defer to the project's own skills and config. This skill only fills gaps.

## Prime directives

1. **Collaborative, not autonomous.** Ask questions before proposing. Present 2–4 options with pros/cons. The user makes every decision. Draft before finalizing; nothing significant is written without sign-off.
2. **A parse check is not a run.** Any story that changes what the player sees is not done until the game has been launched, observed, and a screenshot saved under `production/qa/evidence/`. This holds at every rigor level, including minimal.
3. **Docs scale with rigor** — never silently skipped, never inflated. The configured rigor decides how much design documentation exists before code.
4. **Respect domain boundaries.** Flag cross-department effects before making them (e.g. a combat change that touches networking); cross-domain changes are coordinated, not slipped in.
5. **Gate verdicts are advisory.** Reviews guide the decision; the user always decides whether to proceed.

## Orient first

On first engagement with a game project, establish (in one short round of questions, reusing anything detectable from the repo):

| Question | Options |
|---|---|
| Stage | No idea · vague concept · clear design · existing work |
| Rigor | `minimal` (default) · `standard` · `full` |
| Engine | Godot · Unity · Unreal · other / not yet chosen |

**Rigor** is one front door over six knobs:

- `minimal` — jam speed. A one-page brief replaces the concept doc, art bible, systems map and GDDs. Terse docs, QA = visual evidence only, solo review, stories = one per MVP feature in build order.
- `standard` — 5 required GDD sections, balanced doc depth, standard QA evidence, lean review.
- `full` — all 8 GDD sections, thorough docs, full QA evidence on every story type, full director review.

Minimal is the default: heavier tiers buy traceability, not better games. Suggest raising rigor when the project grows.

Write rigor + engine into `project.yaml` (`modes.rigor`, `modes.automation`, engine name + version). **Never** seed the six underlying knobs (`review_mode`, `workflow`, `docs.density`, `qa.level`, `story_granularity`, `team.size`) into `project.yaml` — they would shadow rigor expansion. Per-developer overrides belong in gitignored `project.local.yaml`.

Code root is engine-specific: Godot `src/`, Unity `Assets/`, Unreal `Source/<Module>/`.

## Minimal path (default)

1. **Engine setup** — pin engine + version, naming conventions, performance budgets → `project.yaml`.
2. **Game brief** — one page: pitch, MVP features, build order → `design/game-brief.md`. The brief's build order *is* the plan.
3. **Stories** — one story per MVP feature, numbered in build order → `production/epics/<slug>/story-*.md`. No epics or sprint docs at this tier.
4. **Build loop** — per story in order: implement → verify acceptance criteria → launch + observe the game + retain screenshot evidence → mark Complete → next.

## Full phase ladder

At `standard`/`full`, run phases in order; each phase's artifacts gate the next (verdicts advisory). Per-step artifacts and required/optional flags: [reference.md](reference.md).

| Phase | Produces | Key steps |
|---|---|---|
| 1. Concept | game concept, art bible, systems index | Brainstorm (MDA), engine setup, art bible, systems map |
| 2. Systems Design | per-system GDDs | Guided GDD authoring, per-system review, cross-GDD consistency review |
| 3. Technical Setup | architecture + ≥3 ADRs + control manifest, accessibility tier, interaction patterns, test framework + CI | Architecture before stories |
| 4. Pre-Production | UX specs (main menu, core HUD, pause), epics per layer, stories per epic, first sprint plan; optional prototype / vertical slice | Validate fun before committing |
| 5. Production | sprint loop | Plan → pick ready story → implement → code review → verify + evidence → close; retro at sprint end |
| 6. Polish | balance check, 3 playtest reports, security audit, release checklist, changelog | Performance, balance, playtesting |
| 7. Release | launch checklist, coordinated go/no-go | Final gate before players |

## Design frameworks (brainstorm & GDD work)

- **MDA** — Mechanics → Dynamics → Aesthetics; analyze the loop in that order.
- **Self-Determination Theory** — autonomy, competence, relatedness: what motivates the player?
- **Flow** — challenge–skill balance; tune difficulty curves against it.
- **Bartle player types** — who is the audience (achievers, explorers, socializers, killers)?
- **Verb-first** — the core verbs define the game; features serve verbs.

## Role discipline

Use the studio hierarchy to structure work and reviews:

- **Directors**: creative-director (vision/pillars), technical-director (architecture), producer (coordination, change propagation, conflict escalation).
- **Leads**: game-designer, lead-programmer, art-director, audio-director, narrative-director, qa-lead, release-manager, localization-lead.
- **Specialists**: gameplay/engine/AI/network/tools/UI programmers, systems/level/economy designers, technical artist, sound designer, writer, world-builder, UX designer, prototyper, performance analyst, security engineer, QA tester, accessibility specialist, live-ops designer.
- **Engine specialist** per project: godot / unity / unreal.
- Same-tier roles consult each other but cannot make binding cross-domain calls; disagreements escalate to the shared parent (design → creative-director, technical → technical-director).

In Cursor, enact reviews by spawning matching subagents (e.g. `code-reviewer` for the lead-programmer pass, `security-review` for the security audit) or by explicitly arguing the role's concerns yourself.

## Quality gates (non-negotiables)

- **Story done** = all acceptance criteria verified + visual evidence captured (if player-visible) + GDD/ADR deviations recorded.
- **Design review** verdicts: APPROVE / MINOR REVISION / MAJOR REVISION; a MAJOR REVISION blocks moving to the next design phase.
- **Architecture**: ≥3 foundation ADRs before stories exist; generate a flat control manifest of programmer rules from accepted ADRs.
- **Pre-production gate**: UX specs exist for main menu, core gameplay HUD, pause menu.
- **Polish → release**: security audit with no open CRITICAL/HIGH findings, release checklist done, changelog drafted.
- **Prototype rule**: throwaway code lives in `prototypes/`, never the code root; a README states the hypothesis.

## Artifact map

```
design/game-brief.md            # minimal path: pitch + MVP features + build order
design/gdd/game-concept.md      # pillars, MDA analysis, scope tiers
design/gdd/systems-index.md     # systems + dependency order + priority tiers
design/gdd/<system>.md          # per-system GDD
design/art/art-bible.md         # visual identity (9 sections)
design/ux/*.md                  # screen specs; design/accessibility-requirements.md
design/assets/                  # entity inventory + asset manifest
docs/architecture/              # architecture.md, adr-*.md, control-manifest.md
production/epics/<slug>/        # EPIC.md + story-*.md
production/sprints/             # sprint-*.md
production/qa/evidence/         # screenshots proving the game was run
production/qa/playtests/        # playtest reports
prototypes/<name>-concept/      # REPORT.md; <name>-vertical-slice/ for slices
```

## Details

Full phase ladder (every step, artifact path, required/optional), command-by-command behavior, `project.yaml` schema notes, and hook-equivalent discipline: [reference.md](reference.md)
