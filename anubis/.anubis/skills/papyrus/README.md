# papyrus

Talk like smart papyrus. Same brain, fewer tokens.

## What it does

Compress every model response to papyrus-style prose. Drops articles, filler, pleasantries, and hedging. Keeps every technical detail, code block, error string, and symbol exact. Cuts 65% of output tokens (measured) with full accuracy preserved. Mode persists for the whole session until changed or stopped.

Six intensity levels:

| Level | What change |
|-------|-------------|
| `lite` | Drop filler/hedging. Sentences stay full. Professional but tight. |
| `full` | Default. Drop articles, fragments OK, short synonyms. |
| `ultra` | Bare fragments. Abbreviations (DB, auth, fn). Arrows for causality. |
| `wenyan-lite` | Classical Chinese register, light compression. |
| `wenyan-full` | Maximum 文言文. 80-90% character reduction. |
| `wenyan-ultra` | Extreme classical compression. |

Auto-clarity rule: papyrus drops to normal prose for security warnings, irreversible-action confirmations, multi-step sequences where fragment ambiguity risks misread, and when user repeats a question. Resumes after the clear part.

## How to invoke

```
/papyrus              # full mode (default)
/papyrus lite         # lighter compression
/papyrus ultra        # extreme compression
/papyrus wenyan       # classical Chinese
stop papyrus          # back to normal prose
```

## Example output

Question: "Why does my React component re-render?"

Normal prose:
> Your component re-renders because you create a new object reference each render. Wrapping it in `useMemo` will fix the issue.

Papyrus (full):
> New object ref each render. Inline object prop = new ref = re-render. Wrap in `useMemo`.

Papyrus (ultra):
> Inline obj prop → new ref → re-render. `useMemo`.

## See also

- [`SKILL.md`](./SKILL.md) — full LLM-facing instructions
- [Papyrus README](../../README.md) — repo overview, install, benchmarks
