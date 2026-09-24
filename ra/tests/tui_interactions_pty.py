#!/usr/bin/env python3
"""Provider-free PTY regression checks for RA's interactive palette behavior."""
import os
import pty
import re
import select
import signal
import struct
import subprocess
import sys
import tempfile
import time
import fcntl
import termios
from pathlib import Path

CSI = re.compile(rb"\x1b\[[0-9;?]*[ -/]*[@-~]")
OSC = re.compile(rb"\x1b\][^\x07]*(?:\x07|\x1b\\)")


def clean(data: bytes) -> str:
    return CSI.sub(b"", OSC.sub(b"", data)).decode("utf-8", errors="replace")


def drain(master: int, seconds: float) -> bytes:
    out = b""
    end = time.time() + seconds
    while time.time() < end:
        readable, _, _ = select.select([master], [], [], 0.05)
        if not readable:
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
    root = Path(__file__).resolve().parents[2]
    cli = root / "ra" / "src" / "cli.ts"
    failures = []

    with tempfile.TemporaryDirectory(prefix="ra-tui-home-") as home, tempfile.TemporaryDirectory(prefix="ra-tui-proj-") as proj:
        homep = Path(home)
        projp = Path(proj)
        (homep / ".ra").mkdir(parents=True, exist_ok=True)
        (homep / ".ra" / "tui.json").write_text(
            '{"theme":"pharaonic","onboarded":true,"mouse":false,"notify":false}\n'
        )
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
            ["bun", str(cli)],
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
            if p.poll() is not None:
                failures.append(("startup", f"TUI exited early with code {p.returncode}", startup[-1800:]))

            # Live preview must be temporary. Search one exact theme, nudge the
            # selection to invoke preview, then Esc should restore pharaonic.
            send(master, b"\x10", 0.4)  # Ctrl+P
            send(master, b"theme:obsidian", 0.5)
            preview = send(master, b"\x1b[B", 0.5)
            if "obsidian" not in preview.lower():
                failures.append(("theme-preview-precondition", "Obsidian preview did not render", preview[-1800:]))
            restored = send(master, b"\x1b", 0.7)
            if "pharaonic" not in restored.lower():
                failures.append(("theme-preview-restore", "Esc did not restore the original pharaonic theme", restored[-2200:]))

            # Clear the palette query left in the editor, then verify that Tab
            # executes the file entry's insert action (@path) instead of its
            # display label.
            send(master, b"\x15", 0.3)  # Ctrl+U
            send(master, b"\x10", 0.4)  # Ctrl+P
            search = send(master, b"app.ts", 0.8)
            if "src/app.ts" not in search:
                failures.append(("file-tab-precondition", "src/app.ts was not visible in palette results", search[-2200:]))
            else:
                inserted = send(master, b"\t", 0.7)
                if "@src/app.ts" not in inserted:
                    failures.append(("file-tab-insert", "Tab did not insert @src/app.ts into the prompt", inserted[-2200:]))

            # Scrolling past the first palette page must keep the selected row
            # highlighted. Group headers used to reset the visible-row index,
            # making the selection marker disappear and mouse hitboxes drift.
            send(master, b"\x15", 0.3)  # Ctrl+U
            send(master, b"\x10", 0.4)  # Ctrl+P
            os.write(master, b"\x1b[B" * 20)
            raw_scroll = drain(master, 1.0)
            last_frame = clean(raw_scroll.split(b"\x1b[H")[-1])
            if "▌" not in last_frame:
                failures.append(("palette-scroll-selection", "Selection marker disappeared after scrolling the palette", last_frame[-2600:]))
            send(master, b"\x1b", 0.4)

            send(master, b"\x04", 0.3)  # Ctrl+D
        finally:
            if p.poll() is None:
                try:
                    os.killpg(p.pid, signal.SIGKILL)
                except Exception:
                    pass
            try:
                os.close(master)
            except Exception:
                pass

    if failures:
        print(f"RA TUI PTY: {len(failures)} regression(s)")
        for name, message, evidence in failures:
            print(f"\nFAIL: {name}\n{message}\n--- terminal evidence ---\n{evidence}")
        return 1

    print("RA TUI PTY: theme preview restore + file Tab insertion + scroll selection PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
