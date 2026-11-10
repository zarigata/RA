# Game Studio — reference

Supplement to `SKILL.md`. Full phase ladder, command glossary, and config notes distilled from [CCGS](https://github.com/Donchitos/Claude-Code-Game-Studios).

## Full phase ladder

Artifact checks: a step is complete when a file matching the glob exists (and contains the pattern, where given). `required: false` steps are optional enhancements. Gate verdicts are advisory — the user decides whether to advance.

### Minimal path (`modes.rigor: minimal`)

The brief's build order is the plan. `/gate-check` is not used at this tier.

1. **Engine setup** (required) → `project.yaml` with `name: "Godot"|"Unity"|"Unreal"` (+ version). Legacy fallback: `.claude/docs/technical-preferences.md` with `**Engine**: <name>`.
2. **Game brief** (required) → `design/game-brief.md` — pitch, MVP features, build order. Replaces concept doc, art bible, systems map and GDDs.
3. **Stories** (required) → `production/epics/*/story-*.md` — one per MVP feature, in build order. No `/create-epics`, no sprint plans.
4. **Implement** (required, repeatable) → `/dev-story` the next story in build order. Each story's Status line (Ready / In Progress / Complete) is the record.
5. **Close the story** (required, repeatable) → verify acceptance criteria, launch + observe + screenshot, mark Complete.

### Phase 1 — Concept

| Step | Req | Artifact |
|---|---|---|
| Brainstorm | opt | — (MDA, verb-first, player psychology) |
| Engine setup | **req** | `project.yaml` engine name+version (or legacy technical-preferences.md) |
| Game concept | **req** | `design/gdd/game-concept.md` — pillars, MDA, scope tiers |
| Concept review | opt | recommended before proceeding |
| Art bible | **req** | `design/art/art-bible.md` (9 sections; uses the Visual Identity Anchor from brainstorm) |
| Systems map | **req** | `design/gdd/systems-index.md` — systems, dependency order, priority tiers |

### Phase 2 — Systems Design

| Step | Req | Artifact |
|---|---|---|
| System GDDs (per system) | **req** | each MVP system `Status: Approved` in systems-index |
| Per-system design review | **req** | no MAJOR REVISION verdict |
| Cross-GDD review | **req** | `design/gdd/gdd-cross-review-*.md` |
| Consistency check | opt | run again whenever a GDD is added/revised mid-project |

### Phase 3 — Technical Setup

| Step | Req | Artifact |
|---|---|---|
| Architecture doc | **req** | `docs/architecture/architecture.md` |
| ADRs (repeatable) | **req** | `docs/architecture/adr-*.md`, min 3 Foundation-layer |
| Architecture review | **req** | `docs/architecture/architecture-review-*.md` |
| Control manifest | **req** | `docs/architecture/control-manifest.md` — flat programmer rules from Accepted ADRs |
| Accessibility requirements | **req** | `design/accessibility-requirements.md` — commit tier (Basic/Standard/Comprehensive/Exemplary) + feature matrix |
| Interaction patterns | **req** | `design/ux/interaction-patterns.md` (gate-required at `full`, recommended at `standard`) |
| Test framework setup | **req** | `.github/workflows/tests.yml` + framework + example test (gate-required at standard/full) |

### Phase 4 — Pre-Production

| Step | Req | Artifact |
|---|---|---|
| Entity & screen inventory | opt | `design/assets/entity-inventory.md` — everything the game needs visually |
| Asset specs (repeatable) | opt | `design/assets/asset-manifest.md` |
| UX specs (repeatable) | **req** | `design/ux/*.md`, min 3: main menu, core gameplay HUD, pause menu |
| UX review | **req** | GDD alignment + accessibility tier compliance, before epics |
| Prototype (concept) | opt | `prototypes/*-concept/REPORT.md` — validate core loop is fun first |
| Epics (per layer) | **req** | `production/epics/*/EPIC.md` — one epic per architectural module |
| Stories (per epic) | **req** | `production/epics/*/story-*.md` |
| First sprint plan | **req** | `production/sprints/sprint-*.md` |
| Vertical slice | opt | `prototypes/*-vertical-slice/REPORT.md` — end-to-end core loop, played and documented before advancing |

Note: prototype and vertical-slice globs are deliberately scoped (`-concept` / `-vertical-slice`) so one can't satisfy the other.

### Phase 5 — Production

| Step | Req | Artifact |
|---|---|---|
| Sprint plan (repeatable) | **req** | `production/sprints/sprint-*.md` |
| Story readiness | opt | validate a story before pickup |
| Implement (repeatable) | **req** | `/dev-story` next ready story; routes to the right programmer role |
| Code review (repeatable) | opt | after dev-story, before story-done |
| Story done (repeatable) | **req** | acceptance criteria + GDD/ADR deviations + evidence |
| QA plan (per epic/sprint) | opt | feeds smoke checks, regression suite, evidence review |
| Bug report / triage | opt | structured backlog |
| Retrospective | opt | end of each sprint, before planning next |
| Team orchestration | opt | multi-agent passes for features spanning domains |
| Scope check | opt | when stories are added mid-sprint, or before retros |
| Sprint status | opt | quick snapshot |

### Phase 6 — Polish

| Step | Req | Artifact |
|---|---|---|
| Performance profile | opt | CPU/GPU/memory bottlenecks |
| Balance check | **req** | formulas + data: outliers, broken progressions |
| Asset audit | opt | naming, formats, size budgets |
| Playtest sessions | **req** | `production/qa/playtests/*.md`, min 3: new-player, mid-game, difficulty curve |
| Polish team pass | **req** | coordinated perf/audio/visual/UX pass |
| Security audit | **req** | `production/security/security-audit-*.md`; no open CRITICAL/HIGH at standard/full |
| Localization QA | opt | per shipped language |
| Release checklist | **req** | code/content/store/legal, before gate-check |
| Changelog | **req** | from commits, sprints, design docs |
| Patch notes | opt | player-facing |

### Phase 7 — Release

| Step | Req | Artifact |
|---|---|---|
| Launch checklist | **req** | final readiness |
| Coordinated release | opt | RC, quality gate, go/no-go, deployment |

## Command glossary (CCGS equivalents → what to do in Cursor)

- `/brainstorm` → guided concept exploration (MDA, verbs, psychology); produces game-brief (minimal) or game-concept (ladder)
- `/setup-engine` → pin engine+version, conventions, budgets into `project.yaml`
- `/map-systems` → decompose concept into systems with dependency order
- `/design-system` → guided per-system GDD authoring, section by section
- `/design-review`, `/review-all-gdds`, `/consistency-check` → design quality gates
- `/create-architecture`, `/architecture-decision`, `/architecture-review`, `/create-control-manifest` → technical setup
- `/ux-design`, `/ux-review`, `/asset-spec`, `/art-bible` → UX/asset/art docs
- `/create-epics`, `/create-stories`, `/sprint-plan`, `/story-readiness`, `/dev-story`, `/story-done` → production backbone
- `/code-review`, `/gate-check`, `/scope-check`, `/balance-check`, `/perf-profile`, `/security-audit`, `/tech-debt` → reviews
- `/qa-plan`, `/smoke-check`, `/soak-test`, `/regression-suite`, `/test-setup`, `/test-helpers` → QA
- `/playtest-report`, `/bug-report`, `/bug-triage`, `/retrospective` → production feedback
- `/release-checklist`, `/launch-checklist`, `/changelog`, `/patch-notes`, `/hotfix`, `/day-one-patch`, `/localize` → release
- `/team-*` → coordinated multi-role passes on cross-domain features
- `/settings` → view/write `project.yaml` (or `--local` for `project.local.yaml`)

## Hook-equivalent discipline (no hooks in Cursor — compensate by habit)

CCGS enforces these via hooks; without them, apply deliberately:

- **Commit hygiene**: no hardcoded magic values in gameplay code (data-driven); TODOs in a consistent format; JSON valid; design docs contain required sections. Validate before `git commit`.
- **Protected branches**: warn on push/tag/merge to protected branches.
- **Design doc read guard**: for a design doc over ~40 KB, read headings first, then a single section — not whole-file.
- **Registry safety**: never silently delete or renumber entries in entity/TR-ID registries.
- **Asset validation**: JSON data under `assets/` must be valid; asset naming per convention.
- **Prototype boundary**: throwaway code never leaves `prototypes/`.
- **Skill hygiene**: after editing a skill, re-test it.

## `project.yaml` notes

- Single source of truth: engine, naming conventions, `modes` block.
- `/start` writes `modes.rigor` + `modes.automation`; the six rigor-fronted knobs (`modes.review_mode`, `modes.workflow`, `docs.density`, `qa.level`, `modes.story_granularity`, `team.size`) must stay OUT of `project.yaml` or they pin values and shadow rigor.
- Per-developer overrides: gitignored `project.local.yaml`.
- Escape hatches: `system_overrides` (hold one system to a higher standard) and `testing.strict` (per test type: does missing evidence block or warn).
- `modes.automation` controls how often the AI pauses to ask before acting; personal override allowed.
