# BUILD/00 — TERRAFORM

**Phase:** 00
**Objective:** Fork opencode, install dependencies, verify the dev environment boots. Everything after this phase builds on a working fork.
**Gate:** `bun install` clean; `anubis --version` boots; dev server starts.

---

## 1. Prerequisites

| Tool | Version | Check |
|---|---|---|
| git | any | `git --version` |
| bun | >= 1.1 | `bun --version` |
| node | >= 20 | `node --version` |
| curl | any | `curl --version` |
| ollama (optional) | any | `ollama list` |

If `bun` is missing:
```bash
curl -fsSL https://bun.sh/install | bash
```

---

## 2. Fork the repository

### 2.1 GitHub fork (recommended)

1. Open https://github.com/anomalyco/opencode
2. Click **Fork** → create fork under your account.
3. Clone your fork:

```bash
git clone https://github.com/<your-username>/opencode.git anubis
cd anubis
```

### 2.2 Direct clone (no GitHub account)

```bash
git clone https://github.com/anomalyco/opencode.git anubis
cd anubis
```

### 2.3 Verify upstream remote

```bash
git remote -v
# origin should point to your fork (or the upstream if direct clone)
# add upstream for rebasing:
git remote add upstream https://github.com/anomalyco/opencode.git
git fetch upstream
```

---

## 3. Install dependencies

```bash
bun install
```

**Expected:** resolves all workspace packages. First run may take 2-5 minutes.

**If `bun install` fails:**
- Check bun version: `bun --version` (need >= 1.1)
- Clear cache: `rm -rf ~/.bun/install/cache && bun install`
- Check network: `curl -fsSL https://registry.npmjs.org/` (should return JSON)

---

## 4. First boot

### 4.1 Build the CLI

```bash
bun run build
```

### 4.2 Run the binary

```bash
bun run cli --version
# or, if the repo exposes a bin:
./packages/opencode/dist/opencode --version
```

**Expected:** prints a version string. If it prints `opencode@x.y.z`, the fork boots.

### 4.3 Start the TUI (smoke test)

```bash
bun run cli
```

**Expected:** TUI opens. Press `q` or `Ctrl+C` to exit. If the TUI renders, the dev environment works.

---

## 5. Verify provider connectivity (optional but recommended)

### 5.1 Local Ollama (free, no keys)

```bash
ollama list
# should show at least one model, e.g. gemma:latest
```

If Ollama is running, opencode auto-detects it. Verify:
```bash
curl -s http://localhost:11434/v1/models | head -c 200
```

### 5.2 Cloud provider (if you have keys)

```bash
# inside the TUI:
/connect
# select your provider, paste key
/models
# pick a model, send a test message
```

---

## 6. Environment matrix

The fork must build on all three OSes. Record results in a table:

| OS | bun install | build | cli --version | TUI boots |
|---|---|---|---|---|
| macOS (this machine) | | | | |
| Linux | | | | |
| Windows (WSL2) | | | | |

**Note:** Windows support is via WSL2 (opencode's documented path). Native Windows is best-effort.

---

## 7. Definition of Done (gate)

Run all of these. All must pass:

```bash
cd anubis
bun install          # exit 0
bun run build        # exit 0
bun run cli --version   # prints version
```

**Gate PASSED** when:
- [ ] `bun install` exits 0
- [ ] `bun run build` exits 0
- [ ] `bun run cli --version` prints a version
- [ ] TUI opens and closes cleanly
- [ ] (optional) Ollama models visible in `/models`

**Gate FAILED** → consult BUILD/11-BUGFIX.md, fix, re-run gate.

---

## 8. Failure modes and fixes

| Symptom | Cause | Fix |
|---|---|---|
| `bun install` network error | registry unreachable | `curl -fsSL https://registry.npmjs.org/`; check proxy |
| `bun install` EACCES | permission | reinstall bun via `curl -fsSL https://bun.sh/install | bash` |
| build fails on native module | missing system dep | `brew install` the reported package (macOS) / `apt install` (Linux) |
| TUI renders garbage | terminal too small | resize to >= 80x24 |
| TUI hangs on start | stale lock | `rm -rf ~/.local/share/opencode` (backup first) |
| `cli --version` unknown command | wrong entry point | check `package.json` `bin` field; use the real path |

---

## 9. Handoff to next phase

When the gate passes, proceed to **BUILD/01-BRAND.md**.

Record in a `BUILD/LOG.md` (create it):
```
## Phase 00 — PASSED
- Date: <date>
- bun: <version>
- node: <version>
- OS: <os>
- Notes: <anything unusual>
```
