#!/usr/bin/env python3
"""Behavioral bug-hunt for RA's full-screen TUI.

Runs without model/provider access. It drives the installed TUI through a real
PTY and checks interaction contracts that unit tests do not currently cover.
"""
import os
import pty
import re
import select
import signal
import struct
import subprocess
import tempfile
import time
import fcntl
import termios
from pathlib import Path

CSI = re.compile(rb"\x1b\[[0-9;?]*[ -/]*[@-~]")
OSC = re.compile(rb"\x1b\][^\x07]*(?:\x07|\x1b\\)")

def clean(data: bytes) -> str:
    data = OSC.sub(b"", data)
    data = CSI.sub(b"", data)
    return data.decode("utf-8", errors="replace")

def drain(master: int, sec: float) -> bytes:
    out = b""
    end = time.time() + sec
    while time.time() < end:
        r, _, _ = select.select([master], [], [], 0.05)
        if not r:
            continue
        try:
            chunk = os.read(master, 65536)
        except OSError:
            break
        if not chunk:
            break
        out += chunk
    return out

def send(master: int, data: bytes, wait: float = 0.5) -> str:
    os.write(master, data)
    return clean(drain(master, wait))

def main() -> int:
    ra = subprocess.check_output(["bash", "-lc", "command -v ra"], text=True).strip()
    failures = []

    with tempfile.TemporaryDirectory(prefix="ra-bughunt-home-") as home, tempfile.TemporaryDirectory(prefix="ra-bughunt-proj-") as proj:
        homep = Path(home)
        projp = Path(proj)
        (homep / ".ra").mkdir(parents=True, exist_ok=True)
        (homep / ".ra" / "tui.json").write_text('{"theme":"pharaonic","onboarded":true,"mouse":false}\n')
        (projp / "src").mkdir()
        (projp / "src" / "app.ts").write_text("export const answer = 42;\n")
        subprocess.run(["git", "init", "-q"], cwd=proj, check=True)

        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 34, 110, 0, 0))
        env = dict(os.environ)
        env.update({
            "HOME": home,
            "TERM": "xterm-256color",
            "COLORTERM": "truecolor",
            "RA_NO_SPLASH": "1",
            "RA_NO_NOTIFY": "1",
        })
        p = subprocess.Popen(
            [ra],
            stdin=slave,
            stdout=slave,
            stderr=slave,
            cwd=proj,
            env=env,
            start_new_session=True,
        )
        os.close(slave)

        try:
            startup = clean(drain(master, 2.5))
            if "RA" not in startup:
                failures.append(("startup", "TUI did not render RA", startup[-1500:]))

            # BUG HUNT 1: live theme preview must be temporary when Esc closes
            # the palette. Starting theme is explicitly pharaonic.
            send(master, b"/theme\r", 0.8)
            preview = send(master, b"\x1b[B", 0.5)
            closed = send(master, b"\x1b", 0.8)
            if "pharaonic" not in closed.lower():
                failures.append((
                    "theme-preview-sticks",
                    "Esc after live theme preview did not restore the original pharaonic theme",
                    closed[-2200:],
                ))

            # BUG HUNT 2: Tab on a file search should insert the palette action
            # text (@path), not append the label to the search query or clear it.
            search = send(master, b"/app.ts", 0.8)
            if "src/app.ts" not in search:
                failures.append((
                    "file-palette-precondition",
                    "File entry was not visible before Tab; cannot validate insertion",
                    search[-2200:],
                ))
            else:
                after_tab = send(master, b"\t", 0.8)
                if "@src/app.ts" not in after_tab:
                    failures.append((
                        "file-tab-insert",
                        "Tab on a file result did not leave @src/app.ts in the editor",
                        after_tab[-2200:],
                    ))
        finally:
            try:
                os.killpg(p.pid, signal.SIGKILL)
            except Exception:
                pass
            try:
                os.close(master)
            except Exception:
                pass

    if failures:
        print(f"RA BUG HUNT: {len(failures)} issue(s) reproduced")
        for name, message, evidence in failures:
            print(f"\nBUG: {name}\n{message}\n--- terminal evidence ---\n{evidence}")
        return 1

    print("RA BUG HUNT: no targeted TUI regressions reproduced")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
