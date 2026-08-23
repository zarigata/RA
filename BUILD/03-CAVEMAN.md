# BUILD/03 — CAVEMAN

**Phase:** 03
**Objective:** Embed the caveman skill suite into the fork so every Anubis agent can compress output and save tokens.
**Gate:** caveman skills load; `/caveman` command works; agents see `<available_skills>`.

---

## 1. What caveman is

Caveman is a set of skills (SKILL.md files) that make AI output ultra-compressed — "caveman speak" — cutting token usage ~65% while keeping technical accuracy. The skills already exist on this machine at:

```
~/.config/opencode/skills/
```

| Skill | Purpose |
|---|---|
| caveman | compression mode (lite/full/ultra/wenyan) |
| caveman-commit | compressed commit messages |
| caveman-compress | compress memory files |
| caveman-help | quick reference |
| caveman-review | compressed code review comments |
| caveman-stats | token usage stats |
| cavecrew | subagent delegation guide |
| cancel-ralph | cancel loop |
| ralph-loop | auto-continue loop |
| help | plugin help |

---

## 2. Embed into the fork

### 2.1 Copy skills into the repo

```bash
mkdir -p .opencode/skills
cp -r ~/.config/opencode/skills/* .opencode/skills/
```

### 2.2 Verify structure

```bash
ls .opencode/skills/
# each skill must be a directory containing SKILL.md
ls .opencode/skills/caveman/SKILL.md
```

### 2.3 Validate frontmatter

Each SKILL.md must have `name` and `description` in YAML frontmatter. Validate:

```bash
for f in .opencode/skills/*/SKILL.md; do
  head -3 "$f" | grep -q "^name:" || echo "MISSING name: $f"
  head -3 "$f" | grep -q "^description:" || echo "MISSING description: $f"
done
```

Fix any missing fields. Name must match the directory name and the regex `^[a-z0-9]+(-[a-z0-9]+)*$`.

---

## 3. Enable skills for all roles

Add to `opencode.json` (or the fork's default config):

```jsonc
{
  "permission": {
    "skill": {
      "*": "allow"
    }
  }
}
```

This lets every agent load any skill. To restrict, see BUILD/02 permissions per role.

---

## 4. Caveman as a plugin (optional enhancement)

Caveman is skill-based. For automatic compression (not just on-demand), add a thin plugin that injects the caveman system prompt when the user says "caveman mode":

`.opencode/plugins/caveman.ts`:

```ts
import type { Plugin } from "@opencode-ai/plugin"

export const CavemanPlugin: Plugin = async ({ client }) => {
  return {
    "tui.prompt.append": async (input, output) => {
      const text = input.prompt ?? ""
      if (/caveman|talk like caveman|be brief|less tokens/i.test(text)) {
        output.prompt = text + "\n\n[CAVEMAN MODE] Respond ultra-compressed. Drop articles, filler, pleasantries. Fragments OK. Technical terms exact. Code unchanged."
      }
    },
  }
}
```

---

## 5. Definition of Done (gate)

```bash
cd anubis
bun run build
bun run cli
# in TUI:
#   /caveman help
#   "list available skills"  → should show caveman skills in <available_skills>
#   "caveman mode" then "explain the build" → response should be compressed
```

**Gate PASSED** when:
- [ ] `.opencode/skills/` contains all caveman skills
- [ ] All SKILL.md files have valid frontmatter
- [ ] Agents see caveman skills in `<available_skills>`
- [ ] `/caveman help` works
- [ ] Caveman mode compresses output

**Gate FAILED** → BUILD/11-BUGFIX.md.

---

## 6. Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| skill not discovered | wrong dir or bad name | check `.opencode/skills/<name>/SKILL.md`; name must match dir |
| skill hidden | permission deny | set `"skill": {"*": "allow"}` |
| frontmatter ignored | unknown fields | only `name`, `description`, `license`, `compatibility`, `metadata` recognized |
| duplicate skill name | collision with global | rename or remove the duplicate |

---

## 7. Handoff

Gate passed → **BUILD/04-PONYTAIL.md**.

Log in `BUILD/LOG.md`:
```
## Phase 03 — PASSED
- Date: <date>
- Skills embedded: <count>
- Caveman plugin: <yes/no>
```
