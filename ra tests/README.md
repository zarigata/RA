# Installed-terminal acceptance

These scenarios run the installed `ra` executable, not RA source imports, `bun test`, `test.sh`, or the built-in benchmark/eval scripts. Coding calls use real Ollama Cloud models. Interactive cases use a PTY and type commands, wait for a prompt, inspect output, and exit. Generated programs are checked independently with Python, Node, or Bun.

`RESULTS.md` records the .69 measured results, the .71 coding regression (21/21, `evidence/regression-71/`), and the .72 fallback feature (4/4, `evidence/fallback-72/`). `AGENT_RESULTS.md` covers the .70 team/worktree extension plus the .71 team regression (16/16, `evidence/agents-70/regression-71/`). `SAFETY_RESULTS.md` covers .71 native command isolation and points at both regression runs. `COMPETITIVE_RESULTS.md` records the fixed-budget comparison against other installed coding agents (`competitive_acceptance.py`). JSON evidence includes commands, exit codes, durations, model assignments, output, and assertions. Earlier failed attempts remain available; they are not counted as passes.

## macOS isolation

The tested installation is `/private/tmp/ra-user-sandbox/bin/ra`, backed by a separate copy under `app`. Each scenario gets a fresh project and HOME. The driver writes an explicit cloud acceptance configuration and selects it through `RA_CONFIG`; the stock LAN profile is not the subject of this run. Existing scenario artifacts are archived, not reused to obtain a pass. The user's normal installation and `~/.ra` are untouched.

The .69/.70 historical runs used `sandbox.sb`, an outer write sandbox that allowed reads/networking. Starting with .71, RA itself sandboxes command subprocesses with workspace/read-only and network controls. Run the driver directly, without an outer Seatbelt wrapper: macOS does not support nested sandbox initialization. The driver and RA controller are trusted; generated shell commands, compiler processes, stdio MCP, verification, and swarm Git enter RA's native boundary. This is not a VM.

To reproduce, copy a clean checkout into `/private/tmp/ra-user-sandbox/app` without `.env`, private data, `.git`, or `node_modules`, then:

```sh
mkdir -p /private/tmp/ra-user-sandbox/{bin,home,projects,evidence}
HOME=/private/tmp/ra-user-sandbox/home \
RA_INSTALL_DIR=/private/tmp/ra-user-sandbox/bin \
  bash /private/tmp/ra-user-sandbox/app/install
cp 'ra tests/sandbox.sb' /private/tmp/ra-user-sandbox/policy.sb
cp 'ra tests/terminal_acceptance.py' 'ra tests/agent_acceptance.py' \
  'ra tests/safety_acceptance.py' /private/tmp/ra-user-sandbox/
# Export OLLAMA_API_KEY privately before running. Never put it in source control.
python3 /private/tmp/ra-user-sandbox/terminal_acceptance.py \
  --small-model ollama-cloud/glm-5.3-flash
python3 /private/tmp/ra-user-sandbox/agent_acceptance.py \
  --small-model ollama-cloud/glm-5.3-flash
python3 /private/tmp/ra-user-sandbox/safety_acceptance.py \
  --small-model ollama-cloud/glm-5.3-flash
```

The optional `--key-rtf /absolute/path/to/credential.rtf` reads the supplied Ollama credential privately into the child environment. `--only` selects comma-separated scenario IDs. `--small-model` selects a different planning/review model. No credential is written into evidence; known-key and ANSI filtering happen before output is saved.

## Acceptance criteria

1. Installed help and version execute without repository test scripts.
2. Cloud Python generation creates the requested module and passes independent arithmetic checks.
3. Multi-file JavaScript imports and execution print the expected result.
4. A bug fix preserves unrelated existing content.
5. Project memory is reflected in generated code.
6. Agent-written tests execute against an existing module without changing it.
7. TypeScript executes correctly on representative and empty inputs.
8. JSON edits preserve unrelated settings.
9. Documentation reflects actual code and retains fenced examples.
10. A four-agent plan/implement/review/critique pipeline produces working code.
11. TUI cloud chat answers, handles an unknown command, and remains usable.
12. TUI coding writes executable code and exposes the agent tree.
13. Multiple role agents produce a real cloud synthesis.
14. Undo restores the original file after successive edits.
15. Invalid credentials fail with no synthetic success artifact.
16. Sessions persist and export sanitized transcripts.
17. Missing task, unknown command, and non-terminal interactive use fail clearly.
18. Direct TUI reads reject a symlink outside the project.
19. A planning role does not create the requested file.
20. Escape interrupts a live model request and the TUI accepts another command.
21. A follow-up question can use the preceding conversation.

## Scope of proof

Passing these small scenarios demonstrates specific behavior; it is not evidence of superiority to Codex, OpenCode, or Claude Code, nor production certification. Basic stdio MCP isolation has .71 coverage. Broader MCP transports, remote daemon, IDE integration, long-context compaction, Windows/Linux behavior, and adversarial repository execution require separate acceptance work. Worktree merges are exercised by the separate .70 agent driver. Python `--verify` executes the written Python files with a time limit; JS/TS verification is syntax-only and is not an application test suite. The scenarios add independent behavior checks where applicable.

## Team extension (.70)

`agent_acceptance.py` uses the same installed-CLI/PTY approach and fresh project/HOME directories. It creates disposable Git fixtures, invokes `ra moa` and `ra swarm`, inspects retained worktrees and commits with Git, independently executes generated modules, and deliberately tests failed models, cancellation and integration conflicts. No RA modules or internal test runners are imported.

Copy it into the sandbox and run it directly for .71 (the historical .70 run used the outer Seatbelt wrapper). It defaults to GPT-OSS planning/synthesis, DeepSeek implementation, and GLM reviewers. `--only` accepts comma-separated scenario IDs. All failed attempts are retained alongside final evidence.

## Safety extension (.71)

`safety_acceptance.py` exercises inherited permissions, runtime whitelists, native shell boundaries, credential/symlink/hardlink protection, read-only roles, environment loaders, Node/Bun, IP and Unix-socket policy, stdio MCP, diagnostics, nested fail-closed behavior, cancellation, parent process metadata, and Unicode/spaced workspaces. It invokes the installed CLI and real TUI PTYs only. Synthetic secrets and owned local socket servers test negative boundaries; no real credential is printed by a probe.

It creates explicitly named test-only agent cards in the disposable installation. `--guard-model` controls the two adversarial permission fixtures. A model refusal that never reaches the runtime guard is recorded as a failed/inconclusive test, not a pass. Every model-selection change is stated in the report. Source hashes tie the installed runtime to the workspace.
