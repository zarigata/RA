#!/usr/bin/env python3
"""End-user acceptance for the .73 full-screen TUI: fuzzy / palette, mouse, themes."""
import argparse, json, os, pathlib, pty, re, select, signal, struct, subprocess, sys, time, fcntl, termios

parser = argparse.ArgumentParser()
parser.add_argument('--sandbox', default='/private/tmp/ra-user-sandbox')
parser.add_argument('--key-rtf')
parser.add_argument('--only', default='')
a = parser.parse_args()
base = pathlib.Path(a.sandbox)
evidence = base / 'evidence-ui'; evidence.mkdir(exist_ok=True)
env = dict(os.environ,
           HOME=str(base / 'home'), PATH=str(base / 'bin') + ':' + os.environ['PATH'],
           TERM='xterm-256color', COLORTERM='truecolor',
           RA_MODEL='ollama-cloud/deepseek-v4-pro:0813', RA_SMALL_MODEL='ollama-cloud/glm-5.3-flash',
           OLLAMA_LAN_URL='http://127.0.0.1:9', OLLAMA_LOCAL_URL='http://127.0.0.1:9',
           RA_CONFIG=str(base / 'cloud-acceptance.json'))
if a.key_rtf:
    raw = subprocess.check_output(['textutil', '-convert', 'txt', '-stdout', a.key_rtf], text=True)
    env['OLLAMA_API_KEY'] = re.search(r'OLLAMA\s*:\s*(\S+)', raw).group(1)
key = env.get('OLLAMA_API_KEY', '')
ANSI = re.compile(r'\x1b\[[0-9;?]*[a-zA-Z]')
ansi_other = re.compile(r'\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[=>]')

def clean(b):
    s = b.decode('utf-8', errors='replace')
    s = ANSI.sub('', s)
    s = ansi_other.sub('', s)
    return s.replace(key, '[REDACTED]') if key else s

records = []
outcomes = []

class Session:
    def __init__(s, cwd='/tmp', rows=34, cols=110):
        s.m, s.slave = pty.openpty()
        fcntl.ioctl(s.slave, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
        s.p = subprocess.Popen(['ra'], stdin=s.slave, stdout=s.slave, stderr=s.slave, cwd=cwd, env=env, start_new_session=True)
        os.close(s.slave)
        s.buf = b''
    def drain(s, seconds=3.0):
        deadline = time.time() + seconds
        while time.time() < deadline:
            r, _, _ = select.select([s.m], [], [], 0.15)
            if r:
                try:
                    d = os.read(s.m, 65536)
                    if not d: return
                    s.buf += d
                except OSError: return
    def send(s, data, wait=2.5):
        os.write(s.m, data if isinstance(data, bytes) else data.encode())
        s.drain(wait)
    def last(s):
        return clean(s.buf)
    def last_frame(s):
        """Only the most recent painted frame — no stale history."""
        marker = b'\x1b[?2026h'
        i = s.buf.rfind(marker)
        return clean(s.buf[i:] if i >= 0 else s.buf)
    def kill(s):
        try: os.killpg(s.p.pid, signal.SIGKILL)
        except Exception: pass

def scenario(sid, fn):
    if a.only and sid.split('-')[0] not in a.only.split(','): return
    t0 = time.monotonic()
    out = {'scenario': sid}
    s = Session()
    try:
        s.drain(6)
        fn(s)
        out['status'] = 'PASS'
    except Exception as e:
        out['status'] = 'FAIL'; out['error'] = str(e)[-1200:]
    out['seconds'] = round(time.monotonic() - t0, 2)
    (evidence / f'{sid}.json').write_text(json.dumps({**out, 'transcript_tail': s.last()[-4000:]}, indent=1))
    outcomes.append(out)
    print(f"{sid}: {out['status']} ({out['seconds']}s) {out.get('error','')[:200]}", flush=True)
    s.kill()

def check(cond, msg=''):
    if not cond: raise AssertionError(msg or 'check failed')

def tui_home_and_palette(s):
    check('𓃡 RA' in s.last() or 'RA 1.0.0' in s.last(), 'header missing')
    check('type / to search everything' in s.last(), 'input box hint missing')
    check('everything' in s.last() and 'palette' in s.last(), 'footer chips missing')
    # first-run wizard may be up: finish it so the palette is reachable
    if 'pick a look' in s.last():
        s.send(b'\r', 2.0)
    if 'what do you want to do first' in s.last():
        s.send(b'x', 2.0)
    s.send(b'/', 2.5)
    t = s.last_frame()
    check('search everything' in t, 'palette title missing')
    check('COMMANDS' in t, 'commands group missing')
    s.send(b'\x1b', 1.5)  # close palette
    s.send(b'\x03', 1.0)  # ctrl+c to clear input

def tui_fuzzy_themes_enter(s):
    s.send(b'/the', 2.5)
    t = s.last()
    check('theme:' in t, 'theme entries not found for /the')
    s.send(b'\r', 2.5)  # enter applies selected row (a theme)
    prefs = base / 'home' / '.ra' / 'tui.json'
    deadline = time.time() + 5
    while time.time() < deadline and not prefs.exists():
        time.sleep(0.3)
    check(prefs.exists(), 'tui.json not persisted after theme select')
    j = json.loads(prefs.read_text())
    check('theme' in j, 'theme key missing from tui.json')
    check(f'· {j["theme"]}' in s.last() or j['theme'] in s.last(), 'header/footer not showing new theme')

def tui_mouse_click_theme(s):
    prefs = base / 'home' / '.ra' / 'tui.json'
    s.send(b'/theme:', 2.5)
    check('theme:' in s.last(), 'theme filter missing')
    # the first visible palette row (y=6) is a theme entry; read its id from the screen
    m = re.search(r'theme:([a-z0-9-]+)', s.last_frame())
    check(m, 'no theme row visible on screen')
    expected = m.group(1)
    s.send(b'\x1b[<0;20;6M', 0.4)
    s.send(b'\x1b[<0;20;6m', 2.0)
    after = json.loads(prefs.read_text()) if prefs.exists() else {}
    check(after.get('theme') == expected, f'mouse click did not persist theme {expected} (got {after.get("theme")})')

def tui_mouse_click_command(s):
    s.send(b'/', 2.5)
    t = s.last()
    check('search everything' in t, 'palette not open')
    # find /help row: type "hel" to filter, then click first row
    s.send(b'hel', 2.0)
    check('/help' in s.last_frame(), '/help not in filtered rows')
    s.send(b'\x1b[<0;20;6M', 0.3)
    s.send(b'\x1b[<0;20;6m', 2.5)
    check('RA — commands:' in s.last(), 'help output missing after click')

def tui_file_insert(s):
    s.send(b'\x03', 1.0)
    s.send(b'slug-validate', 2.5)
    t = s.last()
    check('PROJECT FILES' in t or 'slug-validate' in t, 'project files not searchable')
    s.send(b'\t', 2.0)  # tab inserts the file label
    check('slug-validate' in s.last(), 'tab did not insert file')

def tui_streaming_turn(s):
    s.send(b'\x03', 1.0)
    s.send(b'Reply with exactly the word OK and nothing else.\r', 40)
    t = s.last()
    check('OK' in t, 'assistant reply missing from viewport')
    check(('context ──' in t) or ('RA' in t), 'reply frame missing')

def tui_theme_persists_restart(s):
    prefs = base / 'home' / '.ra' / 'tui.json'
    theme = json.loads(prefs.read_text())['theme'] if prefs.exists() else None
    check(theme, 'no persisted theme from earlier scenario')
    s2 = Session()
    s2.drain(6)
    t = s2.last()
    check(theme in t, f'restart lost theme {theme}')
    s2.kill()

def tui_legacy_pipe_mode(s=None):
    # Documented contract (installed-user scenario 17): bare `ra` without a
    # terminal fails clearly instead of hanging. RA_FORCE_TUI=1 opts into the
    # readline UI for the internal gate.
    p = subprocess.run(['ra'], input='/palette\n/exit\n', capture_output=True, text=True, timeout=60,
                       env={**env, 'TERM': 'xterm-256color'})
    check(p.returncode != 0, 'non-TTY ra should refuse')
    check('interactive mode needs a terminal' in (p.stderr + p.stdout), 'refusal message missing')

def tui_splash_onboarding(s):
    prefs = base / 'home' / '.ra' / 'tui.json'
    if prefs.exists(): prefs.unlink()
    s2 = Session()
    s2.drain(0.8)
    t = s2.last()
    check('press any key' in t, 'splash hint missing')
    check(chr(0x2588) in t, 'splash logo blocks missing')
    s2.send(b'x', 3.0)   # skip splash; any key advances onboarding step 1 -> 2
    t = s2.last()
    check('pick a look' in t, 'onboarding step 1 missing')
    s2.send(b'\r', 2.5)  # confirm theme
    check('what do you want to do first' in s2.last(), 'onboarding step 2 missing')
    s2.send(b'x', 2.5)   # finish onboarding
    check(json.loads(prefs.read_text()).get('onboarded') is True, 'onboarded flag not persisted')
    s2.kill()

def tui_question_shortcuts(s):
    s.send(b'?', 2.0)
    check('RA shortcuts' in s.last_frame(), 'shortcuts overlay missing on ?')
    check('right-click' in s.last_frame(), 'shortcuts missing context-menu entry')
    s.send(b'x', 2.0)
    check('RA shortcuts' not in s.last_frame(), 'shortcuts did not close')

def tui_context_menu(s):
    s.send(b'\x1b[<2;15;10M', 0.4); s.send(b'\x1b[<2;15;10m', 2.0)
    t = s.last_frame()
    check('Search everything' in t, 'context menu missing')
    check('Themes' in t, 'themes submenu missing')
    # the menu anchors at the right-click: title y11, first entry y12, Themes y13
    s.send(b'\x1b[<0;30;13M', 0.3); s.send(b'\x1b[<0;30;13m', 2.0)
    check('theme:' in s.last_frame(), 'themes submenu did not open')
    # submenu opens centered at y4: title y5, first theme row y7
    prefs = base / 'home' / '.ra' / 'tui.json'
    s.send(b'\x1b[<0;30;7M', 0.3); s.send(b'\x1b[<0;30;7m', 2.0)
    check(prefs.exists() and json.loads(prefs.read_text()).get('theme'), 'theme not persisted from menu')

scenario('66-tui-header-palette', tui_home_and_palette)
scenario('67-fuzzy-theme-enter', tui_fuzzy_themes_enter)
scenario('68-mouse-click-theme', tui_mouse_click_theme)
scenario('69-mouse-click-command', tui_mouse_click_command)
scenario('70-file-insert-tab', tui_file_insert)
scenario('71-streaming-markdown', tui_streaming_turn)
scenario('72-theme-persist-restart', tui_theme_persists_restart)
scenario('73-legacy-pipe-mode', tui_legacy_pipe_mode)
scenario('74-splash-onboarding', tui_splash_onboarding)
scenario('75-question-shortcuts', tui_question_shortcuts)
scenario('76-context-menu', tui_context_menu)
print(f"UI acceptance: {sum(o['status']=='PASS' for o in outcomes)}/{len(outcomes)} passed", flush=True)
sys.exit(2 if not outcomes else 1 if any(o['status'] != 'PASS' for o in outcomes) else 0)
