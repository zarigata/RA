# RA — Relic Agent

Terminal coding agent inspired by OpenCode. Small models on LAN, BIG models on Ollama Cloud.

## Install

```bash
git clone <repo> RA && cd RA
./install
```

## Quick start

```bash
cd ~/my-project
ra init
ra                              # interactive TUI
ra --task "add hello world" --quick --verify
ra demo                         # one-shot full-dev in a temp dir
ra doctor                       # .251 qwen + cloud + localhost gemma
ra ping                         # latency check
ra env                          # endpoints (keys masked)
ra last / ra history
```

## Test (bash gate — always)

```bash
./test.sh
```

Must show **RA** branding, **RA TUI** boxes (`v1.0.0-ra.*`), `qwen3.8` on **@251** (or gemma `@local`), code on **@cloud**, `took Nms` per stage, a written file, and `RA RESULT`.

## In the TUI

| Command | Action |
|---------|--------|
| `/quick <task>` | Full-dev plan→code with RA TUI |
| `/plan` `/code` `/pipeline` | Plan / implement / full pipeline |
| `/ping` `/env` `/doctor` | Connectivity |
| `/status` `/cost` `/files` `/history` `/ls` | Session |
| `/simple on` | Grandma mode |
| `Ctrl+P` | Command palette |

## Models (mac-weak profile)

- **Small** → `192.168.1.251` `qwen3.8:latest`
- **Fallback** → `localhost` gemma if `.251` is down
- **BIG** → Ollama Cloud `glm-5.2` (`OLLAMA_API_KEY` in `anubis/.env`)

## License

MIT — inspired by [OpenCode](https://github.com/anomalyco/opencode) (MIT).
