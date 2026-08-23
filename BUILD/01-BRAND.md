# BUILD/01 — BRAND

**Phase:** 01
**Objective:** Rebrand the fork from "opencode" to "Anubis" — package name, binary name, TUI splash, and user-facing strings. Keep the codebase intact; branding is cosmetic + package metadata.
**Gate:** `anubis --version` prints an Anubis version; TUI splash shows "Anubis".

---

## 1. Scope

Rebrand these surfaces:

| Surface | File(s) | Change |
|---|---|---|
| Package name | `package.json` (root + packages) | `opencode` → `anubis` |
| Binary name | `package.json` `bin` field | `opencode` → `anubis` |
| TUI splash | `packages/tui/src/` (splash/logo) | "opencode" → "Anubis" |
| Version string | `packages/opencode/package.json` | keep semver, add `-anubis` suffix |
| Help text | CLI help output | "opencode" → "anubis" |
| Config dir | `~/.local/share/opencode` | keep as-is (compat) OR migrate to `~/.local/share/anubis` (see 3.3) |
| README | `README.md` | Anubis branding (full rewrite in BUILD/12) |

---

## 2. Exact edits

### 2.1 Root package.json

```bash
# find all package.json files
find . -name package.json -not -path "*/node_modules/*"
```

For each, replace the `name` field:
```json
"name": "anubis"
```

For the CLI package, also update `bin`:
```json
"bin": {
  "anubis": "./dist/index.js"
}
```

### 2.2 Version suffix

In the CLI package `package.json`:
```json
"version": "<upstream-version>-anubis.1"
```

### 2.3 TUI splash

Search for the splash/logo string:
```bash
grep -rn "opencode" packages/tui/src --include="*.tsx" --include="*.ts" -l
```

Replace the visible brand string with `Anubis`. Keep the ASCII art structure; swap the word.

### 2.4 CLI help

```bash
grep -rn "opencode" packages/opencode/src --include="*.ts" -l
```

Replace user-facing "opencode" strings with "anubis". **Do not** rename internal identifiers, function names, or config keys — those stay `opencode` for upstream compatibility.

---

## 3. Config directory decision

### 3.1 Option A — keep `~/.local/share/opencode` (recommended for v1)

- Zero migration risk.
- Existing auth.json, sessions, and skills keep working.
- Anubis and upstream opencode share state (fine for a fork).

### 3.2 Option B — migrate to `~/.local/share/anubis`

- Clean separation.
- Requires finding the config-path constant and changing it.
- Existing users lose their opencode state unless they copy it.

**Decision for v1: Option A.** Document Option B as a future enhancement.

---

## 4. Definition of Done (gate)

```bash
cd anubis
bun run build
bun run cli --version
# expected: anubis@<version>-anubis.1
bun run cli
# expected: TUI splash shows "Anubis"
```

**Gate PASSED** when:
- [ ] `anubis --version` prints an Anubis version
- [ ] TUI splash shows "Anubis"
- [ ] `bun run build` still exits 0
- [ ] Existing opencode config still loads (no migration errors)

**Gate FAILED** → BUILD/11-BUGFIX.md.

---

## 5. Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| build fails after rename | a file imports the old package name | `grep -rn "opencode" package.json`; fix import paths |
| splash unchanged | wrong file edited | grep for the actual splash string; edit the right file |
| `anubis` command not found | bin not rebuilt | `bun run build` again; check `bin` path |
| config errors on boot | renamed config dir accidentally | revert to Option A; restore `~/.local/share/opencode` |

---

## 6. Handoff

Gate passed → **BUILD/02-ROLES.md**.

Log in `BUILD/LOG.md`:
```
## Phase 01 — PASSED
- Date: <date>
- Binary: anubis@<version>-anubis.1
- Config dir: ~/.local/share/opencode (Option A)
```
