# RA — Relic Agent

An MIT-licensed terminal coding agent with a CLI, interactive TUI, role agents, and configurable Ollama Cloud or local models. RA can inspect projects, write and edit files, run commands, review changes, and preserve session history.

## Install

Requires Bun and Git. From a checkout:

```sh
./install
export PATH="$HOME/.local/bin:$PATH"
ra help
```

`RA_INSTALL_DIR` changes the executable directory. The launcher uses this checkout, so keep it in place. No package-manager dependencies are required for the runtime.

## Cloud-only setup

Set `OLLAMA_API_KEY` privately in your shell; do not paste it into tracked files. See [Ollama authentication](https://docs.ollama.com/api/authentication).

```sh
export RA_MODEL="ollama-cloud/deepseek-v4-pro:0813"
export RA_SMALL_MODEL="ollama-cloud/gpt-oss:120b"
cd /path/to/your/project
ra run "Fix the bug in the price calculator and check edge cases" --quick --verify
ra
```

These model IDs were exercised against the live cloud catalog on 2026-08-30. Availability and model behavior can change. `RA_MODEL` selects implementation/general work; `RA_SMALL_MODEL` selects planning and review. Exported values take precedence over `.env`, including the API key. Explicit cloud selections stay on cloud; authentication failures do not silently switch to a local model.

### Explicit model fallbacks

When a model fails on a provider error (timeouts, 5xx, upstream stream errors, unknown model), the agent loop tries an explicit fallback chain in order and states what happened:

```
RA fallback: ollama-cloud/deepseek-v4-pro:0813 unavailable → gpt-oss:120b (nativeChatStream 502: ...)
```

Configure chains per model or as a default in your `RA_CONFIG` JSON:

```json
{
  "fallbacks": {
    "default": ["ollama-cloud/gpt-oss:120b"],
    "models": {
      "ollama-cloud/deepseek-v4-pro:0813": ["ollama-cloud/kimi-k2.7-code", "ollama-cloud/gpt-oss:120b"]
    }
  }
}
```

`RA_FALLBACK` and `RA_SMALL_FALLBACK` (comma-separated model IDs) do the same for `RA_MODEL` and `RA_SMALL_MODEL` without touching the config file. Rules: candidates must be the same host kind as the primary — a cloud model never silently degrades to a LAN or local model; authentication failures and your own cancellations fail loudly instead of falling back; every switch is printed in the CLI (stderr, so `--json` stays parseable), shown in the TUI stream, recorded per stage in `ra last --json`, and attributed in the stage output of role commands. Without configuration, a conservative same-kind chain applies (`gpt-oss:120b` → `glm-5.2` → `deepseek-v4-flash:0731` for cloud models).

Without overrides, the existing `mac-weak` configuration uses LAN Qwen with local Gemma fallback and a cloud implementation model. Set `RA_CONFIG` to an absolute JSON configuration path to keep custom provider, role, permission, and pipeline settings outside the installation.

## The TUI

Run `ra` in a terminal and you get a full-screen workspace:

- **Header** — logo, version, profile, and the small/big models in play.
- **Conversation** — markdown-rendered replies (headings, lists, bordered code blocks), live token streaming with a spinner, cost sidebar after each turn, subagent tree.
- **Input box** — bordered, with a cursor; type `/` and the **unified palette** fuzzy-searches *everything at once*: commands (built-in and custom), agents (pick one to delegate directly), project files (inserted as `@` references), sessions, models (switch big/small per session), and themes. Keyboard (`↑↓` select, `enter` run, `tab` insert, `esc` close) and **mouse** both work — click a row to run it, wheel to scroll history.
- **Footer** — clickable key chips plus cwd, git branch, and current theme.

### Customization

`~/.ra/tui.json` persists your choices:

```json
{ "theme": "nord", "mouse": true, "scrollSpeed": 3 }
```

`/theme` (or type `/the` and pick from the palette) switches live among the palettes — pharaonic, obsidian, nord, sunset, emerald, cyberpunk, monochrome, and more. Keybinds remain configurable in `ra.json` (`keybinds`).

## Daily use

| Task | Command |
|---|---|
| Interactive session | `ra` |
| Plan and implement | `ra run "task" --quick` |
| Plan, implement, review, critique | `ra run "task"` |
| Check written artifacts | `ra run "task" --quick --verify` |
| Machine-readable output | `ra run "task" --quick --verify --json` |
| Work in another directory | `ra run "task" --cwd /path/to/project` |
| Inspect last result | `ra last --json`, `ra files`, `ra timings` |
| Restore original edited files | `ra checkpoints`, `ra undo` |
| Sessions and transcript | `ra sessions`, `ra export --out session.md` |
| Configuration and providers | `ra roles`, `ra env`, `ra models`, `ra doctor` |
| Inspect command isolation | `ra sandbox status` |
| Run an isolated command | `ra sandbox exec -- python3 app.py` |
| Discover agent roles | `ra agents` |
| Independent proposals and synthesis | `ra moa "task" --roles thoth,ptah,maat --concurrency 3` |
| Code in separate Git worktrees | `ra swarm run tasks.json --concurrency 2` |
| Review and apply a coding team | `ra swarm status ID`, `ra swarm apply ID` |

With `ra run --json`, standard output contains JSON; verification diagnostics go to standard error. Failed agent stages exit nonzero and persist a failure record. `--verify` runs written Python files with a timeout, checks JS/TS syntax, and performs basic artifact checks. It is **not a substitute for your project's tests**.

In the TUI:

- **Build:** `/plan`, `/code`, `/quick`, `/pipeline`, `/again`.
- **Review and agents:** `/review`, `/critique`, `/docs`, `/moa`, `/agents`, `/tree`.
- **Coding teams:** `/swarm run tasks.json`, `/swarm list`, `/swarm status ID`, `/swarm apply ID`.
- **Project and session:** `/ls`, `/todos`, `/history`, `/replay`, `/status`.
- **Controls:** Ctrl+P opens the palette; Escape cancels active model requests; `/exit` quits.

Place project conventions in `RA.md` or `AGENTS.md`. File tools check project boundaries and checkpoint edits. Nested TASK agents inherit their parent's tool restrictions and shell rules; a child can narrow them, not expand them. Tool whitelists are enforced at execution. Read-only roles cannot write through file tools, shell commands, or stdio MCP. MoA additionally denies shell execution and MCP for every participant.

## Command sandbox

On macOS, shell commands, compiler diagnostics, Python verification, stdio MCP servers, and swarm Git subprocesses use Seatbelt. Defaults: writes within the current workspace, private temporary HOME/cache directories, no subprocess network, and no inherited provider credentials. Credential filenames, agent policy files, Git metadata, and the installed RA runtime receive additional protection. The trusted swarm controller can update its own Git metadata; agent shells cannot.

```sh
ra sandbox status
ra sandbox exec -- python3 app.py
ra sandbox exec --mode read-only -- node check.js
ra sandbox exec --network allow -- npm install
```

Use `/sandbox` in the TUI. Configure `"sandbox": {"mode":"workspace-write","network":"deny"}` in `RA_CONFIG`; `RA_SANDBOX` and `RA_SANDBOX_NETWORK` override those settings. Read-only agent capabilities still force read-only execution. `network=allow` enables outbound IP traffic and loopback listeners, not local Unix sockets. Package downloads require it; support for every package manager is not established.

Unsupported platforms and nested sandboxes fail closed. `--mode off` explicitly disables OS isolation for trusted work; the environment is still filtered. Install RA outside the project it will edit. Retained child processes are killed when their command finishes or is cancelled.

This is a command boundary, **not a VM or a hostile-repository security certification**. Provider requests, explicitly configured HTTP MCP tools, plugins, and RA's own controller run outside this subprocess network policy. File tools use canonical-path checks in that controller. Credential filename checks do not detect all secrets in arbitrary project files. System/runtime directories remain readable. See [the safety report](ra%20tests/SAFETY_RESULTS.md) for measured checks and limitations.

## Agent teams

`ra moa` runs independent, read-only proposals and synthesizes successful results. Failed participants remain visible; one failure does not discard the others. Use `--json` for complete results and shared call counts. MoA cannot implement changes. Use `/code`, `ra run`, or a swarm for that.

`ra swarm` gives each coding task a separate branch and worktree from the same clean Git commit. Put the task file outside the checkout, or commit it first:

```json
[
  {"id":"api","prompt":"Implement the API module and verify it","files":["src/api/"]},
  {"id":"ui","prompt":"Implement the settings view and verify it","files":["src/ui/"]}
]
```

Run `ra swarm run /path/to/tasks.json --concurrency 2`, inspect the reported branches, then `ra swarm apply ID`. Each task can select a different `model`. Optional `files` restricts which changed paths RA accepts into that task's commit. Worktrees, branches, outputs, and manifests are retained, including on failure.

Apply merges task commits in a separate integration worktree before fast-forwarding the original branch. On conflict, resolve and commit in the reported integration directory, then repeat `ra swarm apply ID`. A dirty or moved target checkout is rejected. `--merge` opts into applying automatically when every task succeeds. A successful agent return is not proof that its tests passed; review and run your project's checks before applying.

Teams accept 1–16 tasks/roles and concurrency 1–16 (default 4). Configure shared limits in the JSON selected by `RA_CONFIG`:

```json
"agent_limits": {"max_calls":64,"max_agents":32,"max_depth":3,"timeout_ms":180000}
```

Model retries and nested agents count toward the same operation budget. Escape in the TUI or Ctrl+C in CLI team commands cancels pending work. CLI MoA exits with 0 for complete, 2 for partial, 1 for failed, and 130 for cancellation. Swarms exit 0 for ready/applied, 130 for cancellation, and 1 for failed/partial/conflicted work.

Git worktrees separate normal task edits; they are **not OS security sandboxes**. The ownership check happens before committing, not before every shell write. The built-in sandbox limits subprocess access to each worktree, but does not enforce per-task `files` ownership before every write. Retained worktrees consume disk space and currently require explicit Git cleanup. Automatic model-task resume after a crash is not implemented.

## Installed-user acceptance

See [`ra tests/README.md`](ra%20tests/README.md), [coding results](ra%20tests/RESULTS.md), [team results](ra%20tests/AGENT_RESULTS.md), and [sandbox results](ra%20tests/SAFETY_RESULTS.md). This suite exercises an installed copy on macOS, live Ollama Cloud, and real PTY sessions. It does not use the repository's internal test scripts as proof. It includes independent execution of generated programs and retains failed attempts.

The existing unit and benchmark suites remain separate developer tools. Their full results are not implied by the installed-user acceptance report.

## Status and license

RA is still being developed. The acceptance report states what is verified and what remains untested; it does not establish feature parity or superiority over other coding agents. See `PLAN.md` for the longer roadmap.

MIT. Inspired by [OpenCode](https://github.com/anomalyco/opencode). Existing attribution is preserved in `NOTICE`.
