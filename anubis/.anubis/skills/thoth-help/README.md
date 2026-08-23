# thoth-help

Quick-reference card. One shot, no mode change.

## What it does

Prints a cheat sheet of all papyrus modes, sibling skills, deactivation triggers, and how to set the default mode via env var or config file. One-shot display — does not flip the active mode, write flag files, or persist anything. Use when you forget the slash commands.

## How to invoke

```
/thoth-help
```

Also triggers on "papyrus help", "what papyrus commands", "how do I use papyrus".

## Example output

```
Modes:
  /papyrus              full (default)
  /papyrus lite         lighter
  /papyrus ultra        extreme
  /papyrus wenyan       classical Chinese

Skills:
  /ptah-commit       terse Conventional Commits
  /maat-review       one-line PR comments
  /thoth-stats        session token savings

Deactivate:
  "stop papyrus" or "normal mode"
```

## See also

- [`SKILL.md`](./SKILL.md) — full reference card
- [Papyrus README](../../README.md) — repo overview
