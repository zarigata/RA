# Bugs

Known issues, reproduction, severity, attempted fixes.

> Format: `[SEVERITY] Title — reproduction — attempted fixes`

## Open

(none)

## Resolved

- **[MEDIUM] `runTaskAgent` fence fallback hardcoded `index.html`** — Fixed by reusing `extractCodeFile` to infer the filename from the task + content. The `html-page` eval task now passes on both models.
