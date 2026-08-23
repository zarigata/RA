# Bugs

Known issues, reproduction, severity, attempted fixes.

> Format: `[SEVERITY] Title — reproduction — attempted fixes`

## Open

- **[MEDIUM] `runTaskAgent` fence fallback hardcodes `index.html`** — When the agent returns a fenced code block for a non-HTML task (e.g. "write a Python `add(a,b)` function"), the fallback in `ra/src/agent.ts` writes `index.html` instead of the requested file. Reproduction: `ra eval` → `sum-function` task fails on all models. The `extractCodeFile` logic in `runner.ts` handles this correctly, but `runTaskAgent`'s inline fence fallback does not. Fix: reuse `extractCodeFile` or infer the filename from the task. Not yet attempted.

## Resolved

(none yet)
