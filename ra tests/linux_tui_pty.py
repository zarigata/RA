#!/usr/bin/env python3
"""Drive the full-screen RA TUI through a real PTY (CI-safe, stdlib only)."""
import os, pty, re, select, signal, struct, subprocess, sys, time, fcntl, termios

master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 34, 110, 0, 0))
env = dict(os.environ, TERM="xterm-256color", COLORTERM="truecolor")
p = subprocess.Popen(["ra"], stdin=slave, stdout=slave, stderr=slave, cwd=os.getcwd(), env=env, start_new_session=True)
os.close(slave)
buf = b""
def drain(sec):
    global buf
    end = time.time() + sec
    while time.time() < end:
        r, _, _ = select.select([master], [], [], 0.1)
        if r:
            try:
                d = os.read(master, 65536)
                if not d: return
                buf += d
            except OSError: return
drain(4)
t = re.sub(rb'\x1b\[[0-9;?]*[a-zA-Z]', b'', buf).decode('utf-8', errors='replace')
failures = []
if "press any key" not in t and "R E L I C" not in t:
    failures.append("splash missing")
os.write(master, b"x"); drain(3)
os.write(master, b"\x1b"); drain(1)   # Esc finishes onboarding if it is up
os.write(master, b"\x1b"); drain(1)
t = re.sub(rb'\x1b\[[0-9;?]*[a-zA-Z]', b'', buf).decode('utf-8', errors='replace')
if "Welcome to RA" not in t and "pick a look" not in t:
    failures.append("welcome/onboarding missing")
os.write(master, b"/"); drain(3)
t = re.sub(rb'\x1b\[[0-9;?]*[a-zA-Z]', b'', buf).decode('utf-8', errors='replace')
if "search everything" not in t:
    failures.append("unified palette missing on /")
os.write(master, b"\x1b"); drain(1)
os.write(master, b"?"); drain(2.5)
t = re.sub(rb'\x1b\[[0-9;?]*[a-zA-Z]', b'', buf).decode('utf-8', errors='replace')
if "RA shortcuts" not in t:
    failures.append("shortcuts missing on ?")
try: os.killpg(p.pid, signal.SIGKILL)
except Exception: pass
if failures:
    tail = re.sub(rb'\x1b\[[0-9;?]*[a-zA-Z]', b'', buf[-2500:]).decode('utf-8', errors='replace')
    print("LINUX-TUI FAIL:", "; ".join(failures), flush=True)
    print("LAST FRAME:", repr(tail[-600:]), flush=True)
    sys.exit(1)
print("LINUX-TUI OK: splash, welcome, / palette, ? shortcuts — all rendered", flush=True)
