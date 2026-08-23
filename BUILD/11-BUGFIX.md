# BUILD/11 — BUGFIX

**Phase:** 11
**Objective:** Triage playbook for known failure modes across all phases. When a gate fails, use this to diagnose and fix systematically.
**Gate:** all triaged issues resolved; regression suite green.

---

## 1. Triage process

When a gate fails:

1. **Reproduce** — run the failing command again. Capture exact error.
2. **Classify** — which category below does it match?
3. **Apply fix** — follow the category's fix.
4. **Verify** — re-run the gate.
5. **Log** — record in `BUILD/LOG.md` under "Issues".

---

## 2. Issue categories

### 2.1 Build / dependency issues

| Symptom | Likely cause | Fix |
|---|---|---|
| `bun install` fails | registry/network | `curl -fsSL https://registry.npmjs.org/`; check proxy; `rm -rf ~/.bun/install/cache` |
| build fails on native module | missing system dep | install reported package (brew/apt) |
| version mismatch | bun too old | `bun upgrade` |
| lockfile drift | package.json edited | `bun install` regenerates |

### 2.2 Plugin issues

| Symptom | Likely cause | Fix |
|---|---|---|
| plugin not loaded | wrong path | must be `.opencode/plugins/<name>.ts` |
| hook not firing | wrong hook name | verify against `@opencode-ai/plugin` types |
| SDK API mismatch | opencode version | check `@opencode-ai/plugin` version; adapt code |
| two plugins conflict | same hook/tool | test load order; disable one |
| npm plugin not found | wrong package name | check repo's npm publish name |

### 2.3 Agent / role issues

| Symptom | Likely cause | Fix |
|---|---|---|
| role not found | name mismatch | name must match filename + regex |
| frontmatter error | bad YAML | `bunx yaml-lint .opencode/agents/*.md` |
| role edits when read-only | permission wrong | set `edit: deny` |
| role uses wrong model | model pinned | grep `model:` in agents; remove |
| subagent not in autocomplete | mode wrong | set `mode: subagent` |

### 2.4 MOA / pipeline issues

| Symptom | Likely cause | Fix |
|---|---|---|
| `/moa` not recognized | hook name wrong | use `tui.command.execute` |
| roles run sequentially | SDK lacks parallel | document fallback; keep correctness |
| no aggregation | aggregator not sent | ensure `client.session.prompt` after results |
| infinite loop | stage = orchestrator | validate stages; reject `anubis` |
| role fails mid-run | model error | retry once; report honestly |

### 2.5 LAN issues

| Symptom | Likely cause | Fix |
|---|---|---|
| scan hangs | timeout too long | 300ms + AbortSignal |
| no hosts found | wrong subnet | manual CIDR override |
| models not in picker | provider not merged | ensure `lan.json` merged at startup |
| LAN model slow | network latency | assign LAN to non-interactive roles |
| firewall blocks | host firewall | open port; test with curl |

### 2.6 Router issues

| Symptom | Likely cause | Fix |
|---|---|---|
| role uses wrong model | stale config | check `agent.<role>.model` + `--model` |
| `/roles` empty | config not read | read project + global config |
| model unreachable | bad key/provider | `/connect`; check key |
| model lacks tool-calling | wrong model | router warns; user picks better |

### 2.7 Installer issues

| Symptom | Likely cause | Fix |
|---|---|---|
| 404 on download | asset name mismatch | match CI asset names |
| permission denied | chmod missing | `chmod +x` |
| PATH not updated | wrong profile | detect shell; append correct file |
| binary won't run | missing libc | static build; document glibc |

### 2.8 Test issues

| Symptom | Likely cause | Fix |
|---|---|---|
| can't import plugin | no pure exports | refactor to export testable functions |
| E2E hangs | TUI waits | timeout + stdin pipe |
| LAN test fails w/o server | hard dep | `test.skipIf` |
| flaky timing | race | retry / longer timeout |

---

## 3. Known upstream issues to watch

| Issue | Workaround |
|---|---|
| opencode `small_model` default uses Zen | set `small_model` to a local model in config |
| Anthropic subscription plugins removed in 1.3.0 | use API keys or tier-2 auth plugins |
| Windows native support limited | use WSL2 |
| Ollama tool-calling weak on small models | use `num_ctx` 16k-32k; pick tool-calling models |

---

## 4. Definition of Done (gate)

```bash
cd anubis
bun test tests/unit tests/moa tests/lan tests/router tests/e2e tests/regression
bun run build
bun run cli --version
```

**Gate PASSED** when:
- [ ] All known issues from prior phases resolved
- [ ] Regression suite green
- [ ] Build clean
- [ ] `BUILD/LOG.md` documents every issue + fix

**Gate FAILED** → continue triage; do not advance.

---

## 5. Handoff

Gate passed → **BUILD/12-DOCS.md**.

Log in `BUILD/LOG.md`:
```
## Phase 11 — PASSED
- Date: <date>
- Issues resolved: <n>
- Open issues: <list or none>
```
