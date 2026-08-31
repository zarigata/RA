# RA .75 Linux acceptance — 2026-08-31

RA runs beyond macOS. The command runner now has a Linux backend (bubblewrap) with an end-to-end capability probe; where user namespaces are forbidden it degrades honestly (filesystem-only isolation, network reported as shared) or — with explicit consent (`RA_ALLOW_UNSANDBOXED=1` or `sandbox.allow_unsandboxed: true`) — runs unsandboxed; without a backend and without consent it fails closed with install instructions. macOS Seatbelt behavior is unchanged.

## CI verification (Ubuntu container runner)

Workflow: [`.github/workflows/linux-acceptance.yml`](../.github/workflows/linux-acceptance.yml) — runs on every push to main. Run **33374421557**: **conclusion `success`**, full log [evidence/linux-75/ci-run-33374421557.log](evidence/linux-75/ci-run-33374421557.log).

| Step | Result | Notes |
|---|---|---|
| Install RA as a user (`./install`) | ✓ | bun + bubblewrap on ubuntu runner |
| Real coding task (plan → implement → verify, live Ollama Cloud) | ✓ | `ra exit: 0`; `calc.py` written and independently executed, `direct exit=0` |
| Fail-closed contract | ✓ | without consent, non-backed platforms refuse with "No OS command sandbox" |
| Consent execution | ✓ | `RA_ALLOW_UNSANDBOXED=1` → commands run with the honest consent tag |
| Sandbox isolation when bubblewrap is usable | ✓ | outside-write denied under bwrap (skipped with an honest note on userns-blocked runners) |
| Full-screen TUI through a real PTY | ✓ | "splash, welcome, / palette, ? shortcuts — all rendered" |

## Bugs the Linux run caught and fixed

1. **`bwrapPath` boolean** — `resolveBackend` returned the `hasBwrap` boolean as the executable path; `spawn` failed with `ERR_INVALID_ARG_TYPE` on every Linux command.
2. **Userns-forbidden loopback** — `--unshare-net` needs loopback setup rights CI runners forbid (`RTM_NEWADDR: Operation not permitted`); the capability probe now decides net isolation and reports `network=shared (netns unavailable)` honestly.
3. **Double stdin key wiring** — two `stdin.on("data")` handlers double-processed every keystroke in the full-screen TUI (keys landed in the editor, onboarding blocked the palette). Single `wireKeys` now, plus a 50 ms lone-ESC disambiguation timer so Esc-then-`?` no longer merges into alt+`?`.

## Local Docker run (Docker Desktop, macOS host)

With the daemon healthy, the same driver ran in a local `oven/bun`+Ubuntu container. Two honest findings:

- **Nested namespaces are forbidden** in Docker Desktop's Linux VM even with `seccomp=unconfined` (`Creating new namespace failed: Operation not permitted`) — so the bubblewrap probe correctly reports unusable there and RA fails closed without consent (fail-closed message proven: "No OS command sandbox on this platform…").
- **With consent** (`RA_ALLOW_UNSANDBOXED=1`) the full pipeline runs in the container: **10/11 driver scenarios PASS** — installed version, doctor with cloud reachability, real coding task `exit=0` with `calc.py` printing 5, sandbox status, consent tag `[disabled (no isolation; user consent)]`, sandbox exec, and the full-screen TUI (splash, welcome, `/` palette). The single "FAIL" is scenario L6 (outside-write denial), which assumes bwrap isolation — impossible by definition in consent mode, i.e. the expected result of that environment, not a defect. Full log: [evidence/linux-75/local-docker-run.log](evidence/linux-75/local-docker-run.log).

## Scope

Verified: Ubuntu 24.04-class runner (GitHub Actions container), real coding task, sandbox contracts, full TUI. Unverified here: Windows (consent path exists; no OS sandbox), macOS Linux-container parity of every shell tool, and desktop-Linux terminal matrix. The local Docker daemon stalled during this pass, so the container proof ran in CI; `driver`-equivalent local reproduction is [competitive/acceptance drivers](.) with `ui_acceptance.py` covering the TUI on macOS too.
