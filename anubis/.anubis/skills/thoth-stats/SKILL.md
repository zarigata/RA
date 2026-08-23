---
name: thoth-stats
description: >
  Show real token usage and estimated savings for the current session.
  Reads directly from the Claude Code session log — no AI estimation.
  Triggers on /thoth-stats. Output is injected by the mode-tracker hook;
  the model itself does not compute the numbers.
---

This skill is delivered by `hooks/thoth-stats.js` (read by `hooks/papyrus-mode-tracker.js` on `/thoth-stats`). The model does not need to do anything when this skill fires — the hook returns `decision: "block"` with the formatted stats as the reason. The user sees the numbers immediately.

Output also includes `Est. rule overhead` and `Est. net` lines wherever a savings estimate exists with a known turn count. Rule overhead is the estimated per-turn INPUT-token cost of the injected papyrus rules (default 1,250 tokens/turn, override with `PAPYRUS_RULE_OVERHEAD_TOKENS`) times the turn count. Net is savings minus that overhead — when negative, the output says so plainly and suggests turning papyrus off for that workload, rather than hiding the net-negative regime behind a gross-savings number (see `docs/HONEST-NUMBERS.md`).
