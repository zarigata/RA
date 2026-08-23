---
name: thoth-help
description: >
  Quick-reference card for all papyrus modes, skills, and commands.
  One-shot display, not a persistent mode. Trigger: /thoth-help,
  "papyrus help", "what papyrus commands", "how do I use papyrus".
---

# Papyrus Help

Display this reference card when invoked. One-shot — do NOT change mode, write flag files, or persist anything. Output in papyrus style.

## Modes

| Mode | Trigger | What change |
|------|---------|-------------|
| **Lite** | `/papyrus lite` | Drop filler. Keep sentence structure. |
| **Full** | `/papyrus` | Drop articles, filler, pleasantries, hedging. Fragments OK. Default. |
| **Ultra** | `/papyrus ultra` | Extreme compression. Bare fragments. Tables over prose. |
| **Wenyan-Lite** | `/papyrus wenyan-lite` | Classical Chinese style, light compression. |
| **Wenyan-Full** | `/papyrus wenyan` | Full 文言文. Maximum classical terseness. |
| **Wenyan-Ultra** | `/papyrus wenyan-ultra` | Extreme. Ancient scholar on a budget. |

Mode stick until changed or session end.

## Skills

| Skill | Trigger | What it do |
|-------|---------|-----------|
| **ptah-commit** | `/ptah-commit` | Terse commit messages. Conventional Commits. ≤50 char subject. |
| **maat-review** | `/maat-review` | One-line PR comments: `L42: bug: user null. Add guard.` |
| **papyrus-trim** | `/papyrus-trim <file>` | Compress .md files to papyrus prose. Saves ~46% input tokens. |
| **thoth-help** | `/thoth-help` | This card. |

## Deactivate

Say "stop papyrus" or "normal mode". Resume anytime with `/papyrus`.

## Language

Keep user's language by default. User write Portuguese → reply Portuguese papyrus. Compress the style, not the language. Technical terms, code, commands, commit types, and exact error strings stay verbatim unless user ask for translation.

## Configure Default Mode

Default mode = `full`. Change it:

**Environment variable** (highest priority):
```bash
export PAPYRUS_DEFAULT_MODE=ultra
```

**Config file** (`~/.config/papyrus/config.json` macOS/Linux, `%APPDATA%\papyrus\config.json` Windows):
```json
{ "defaultMode": "lite" }
```

Set `"off"` to disable auto-activation on session start. User can still activate manually with `/papyrus`.

Resolution: env var > config file > `full`.

## More

Full docs: https://github.com/JuliusBrussee/papyrus
