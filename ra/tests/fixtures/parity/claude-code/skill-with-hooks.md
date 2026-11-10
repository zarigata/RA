---
name: dep-risk-check
description: Check dependency risk before adding a package.
hooks:
  PreToolUse:
    - matcher: Bash
      hooks:
        - type: command
          command: ./scripts/audit.sh
          timeout: 10
---

# dep-risk-check

Runs `./scripts/audit.sh` on every Bash call while this skill is active.
