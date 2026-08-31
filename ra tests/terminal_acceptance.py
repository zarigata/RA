#!/usr/bin/env python3
"""End-user acceptance: invokes installed ra only; never imports RA or runs repo tests."""
import argparse, json, os, pathlib, pty, re, select, subprocess, time, signal, sys
parser=argparse.ArgumentParser()
parser.add_argument('--sandbox',default='/private/tmp/ra-user-sandbox')
parser.add_argument('--key-rtf')
parser.add_argument('--only',default='')
parser.add_argument('--small-model',default='ollama-cloud/gpt-oss:120b')
parser.add_argument('--review-model')
a=parser.parse_args(); base=pathlib.Path(a.sandbox); evidence=base/'evidence'; evidence.mkdir(exist_ok=True)
env=dict(os.environ,HOME=str(base/'home'),PATH=str(base/'bin')+':'+os.environ['PATH'],TERM='xterm-256color',RA_MODEL='ollama-cloud/deepseek-v4-pro:0813',RA_SMALL_MODEL=a.small_model,OLLAMA_LAN_URL='http://127.0.0.1:9',OLLAMA_LOCAL_URL='http://127.0.0.1:9')
# Explicit user configuration keeps this reproducible from the stock LAN profile.
config=json.loads((base/'app/anubis/ra.json').read_text())
config['profile']='cloud-acceptance'
config.pop('tier_models',None)
if a.review_model:
 env.pop('RA_SMALL_MODEL',None)
 config['small_model']=a.small_model
 config['agent']={role:{'model':a.review_model if role in ('maat','sekhmet') else env['RA_MODEL'] if role=='ptah' else a.small_model} for role in config['agent']}
config_path=base/'cloud-acceptance.json'
config_path.write_text(json.dumps(config,indent=2)+'\n')
env['RA_CONFIG']=str(config_path)
if a.key_rtf:
 raw=subprocess.check_output(['textutil','-convert','txt','-stdout',a.key_rtf],text=True)
 env['OLLAMA_API_KEY']=re.search(r'OLLAMA\s*:\s*(\S+)',raw).group(1)
key=env.get('OLLAMA_API_KEY','')
ansi=re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]')
def clean(s): return ansi.sub('',s).replace(key,'[REDACTED]') if key else ansi.sub('',s)
records=[]
outcomes=[]
def command(args,cwd,extra=None,timeout=180):
 start=time.monotonic()
 p=subprocess.Popen(args,cwd=cwd,env={**env,**(extra or {})},stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
 try: out,err=p.communicate(timeout=timeout)
 except subprocess.TimeoutExpired:
  os.killpg(p.pid,signal.SIGKILL); out,err=p.communicate(); err+='\nTIMEOUT'
 r={'command':args,'exit':p.returncode,'seconds':round(time.monotonic()-start,2),'stdout':clean(out),'stderr':clean(err)}
 records.append(r); return r

def tui(inputs,cwd,extra=None):
 master,slave=pty.openpty()
 p=subprocess.Popen(['ra','--cwd',str(cwd)],stdin=slave,stdout=slave,stderr=slave,cwd=cwd,env={**env,**(extra or {})},start_new_session=True)
 os.close(slave); transcript=b''; chunks=[]
 def read_prompt(timeout=150):
  nonlocal transcript
  buf=b''; deadline=time.monotonic()+timeout
  while time.monotonic()<deadline:
   if select.select([master],[],[],0.2)[0]:
    try: data=os.read(master,65536)
    except OSError: break
    if not data: break
    buf+=data; transcript+=data
    plain=ansi.sub('',buf.decode(errors='replace'))
    if re.search(r'RA › $',plain) or re.search(r'palette › $',plain): return plain
   if p.poll() is not None: break
  raise AssertionError('TUI did not return to prompt: '+clean(buf.decode(errors='replace'))[-1200:])
 try:
  read_prompt()
  for text in inputs:
   if text.startswith('<cancel>'):
    os.write(master,(text[8:]+'\r').encode()); time.sleep(1); os.write(master,b'\x1b')
   elif text=='<palette>': os.write(master,b'\x10')
   else: os.write(master,(text+'\r').encode())
   chunks.append(read_prompt())
  os.write(master,b'/exit\r')
  deadline=time.monotonic()+10
  while time.monotonic()<deadline:
   if select.select([master],[],[],0.1)[0]:
    try:
     data=os.read(master,65536)
     if not data: break
     transcript+=data
    except OSError: break
   if p.poll() is not None: break
  p.wait(timeout=1)
 finally:
  if p.poll() is None: os.killpg(p.pid,signal.SIGKILL);p.wait()
  os.close(master)
  records.append({'command':['ra','--cwd',str(cwd)],'inputs':inputs,'exit':p.returncode,'stdout':clean(transcript.decode(errors='replace')),'stderr':''})
 assert p.returncode==0
 return [clean(x) for x in chunks]

def run(task,cwd,quick=True,extra=None):
 r=command(['ra','run',task,*(['--quick'] if quick else []),'--json','--verify'],cwd,extra)
 assert r['exit']==0, r['stderr']
 j=json.loads(r['stdout']); assert j['status']=='completed'; assert j['hosts']==['cloud']; assert j['filesWritten']; return j

def check(expr,msg='acceptance failed'):
 if not expr: raise AssertionError(msg)

def scenario(name,fn):
 if a.only and name not in a.only.split(','): return
 global records; records=[]
 cwd=base/'projects'/name
 if cwd.exists():
  archive=base/'artifacts';archive.mkdir(exist_ok=True);cwd.rename(archive/(name+'-'+str(time.time_ns())))
 cwd.mkdir(parents=True)
 env['HOME']=str(base/'home'/'cases'/(name+'-'+str(time.time_ns())))
 pathlib.Path(env['HOME']).mkdir(parents=True)
 start=time.monotonic()
 try: fn(cwd);status='PASS';error=''
 except Exception as e: status='FAIL';error=clean(str(e))
 result={'scenario':name,'status':status,'seconds':round(time.monotonic()-start,2),'error':error,'terminal':records}
 (evidence/(name+'.json')).write_text(json.dumps(result,indent=2)+'\n')
 outcomes.append(result)
 print(f'{name}: {status} ({result["seconds"]}s) {error[:250]}',flush=True)

scenario('01-installed-help',lambda d: check(command(['ra','help'],d)['exit']==0 and command(['ra','version'],d)['exit']==0))
def python_add(d):
 run('Create calc.py defining add(a,b) returning their sum. Do not print anything. Check positive and negative inputs.',d)
 check(command(['python3','-c','from calc import add; assert add(2,3)==5; assert add(-3,2)==-1; assert add(0,0)==0'],d)['exit']==0)
scenario('02-python-cloud',python_add)
def multifile(d):
 run('Create math.mjs exporting sum(values) and app.mjs importing sum from ./math.mjs and printing sum([2,3,5]). No dependencies. Run app.mjs to check it.',d)
 r=command(['node','app.mjs'],d);check(r['exit']==0 and r['stdout'].strip()=='10')
scenario('03-multifile-js',multifile)
def bugfix(d):
 (d/'price.py').write_text('SENTINEL = "keep this exact value"\n\ndef total(prices):\n    return sum(prices) + 1\n')
 run('Fix the off-by-one bug in existing price.py total(prices). Read the file first. Preserve SENTINEL and all unrelated content. Verify empty list and [2,3].',d)
 r=command(['python3','-c','from price import total,SENTINEL; assert total([])==0; assert total([2,3])==5; assert SENTINEL=="keep this exact value"'],d);check(r['exit']==0)
scenario('04-existing-bugfix',bugfix)
def memory(d):
 (d/'RA.md').write_text('For Python modules in this project define PROJECT_TAG = "desert-orchid-73". Use snake_case names. No dependencies.\n')
 run('Create greeting.py defining greet(name) returning "Welcome, " plus name. Follow project conventions.',d)
 check(command(['python3','-c','from greeting import greet,PROJECT_TAG; assert greet("Ada")=="Welcome, Ada"; assert PROJECT_TAG=="desert-orchid-73"'],d)['exit']==0)
scenario('05-project-memory',memory)
def tests(d):
 (d/'slug.py').write_text('def slug(text):\n    return "-".join(text.lower().split())\n')
 run('Read slug.py and create test_slug.py using standard unittest. Test empty, mixed case and repeated spaces; run the tests. Do not change slug.py.',d)
 check(command(['python3','-m','unittest','-v'],d)['exit']==0); check((d/'slug.py').read_text()=='def slug(text):\n    return "-".join(text.lower().split())\n')
scenario('06-write-and-run-tests',tests)
def typescript(d):
 run('Create unique.ts exporting function unique(values: number[]): number[] preserving first occurrence order. No dependencies. Check [3,1,3,2] produces [3,1,2].',d)
 check(command(['bun','-e','import {unique} from "./unique.ts"; if(JSON.stringify(unique([3,1,3,2]))!=="[3,1,2]" || unique([]).length) process.exit(1)'],d)['exit']==0)
scenario('07-typescript',typescript)
def config(d):
 (d/'settings.json').write_text('{"theme":"dark","port":3000,"keep":{"enabled":true}}\n')
 run('Update existing settings.json port to 8080, preserve theme and keep.enabled exactly. Read it first. Output valid JSON.',d)
 check(json.loads((d/'settings.json').read_text())=={'theme':'dark','port':8080,'keep':{'enabled':True}})
scenario('08-json-edit',config)
def documentation(d):
 (d/'convert.py').write_text('def c_to_f(c):\n    return c * 9 / 5 + 32\n')
 run('Read convert.py and create README.md describing c_to_f with examples 0 -> 32 and 100 -> 212. Do not modify Python.',d)
 t=(d/'README.md').read_text();check('c_to_f' in t and '32' in t and '212' in t);check((d/'convert.py').read_text()=='def c_to_f(c):\n    return c * 9 / 5 + 32\n')
scenario('09-documentation',documentation)
def pipeline(d):
 j=run('Create parity.py defining is_even(n) returning whether integer n is even. Test 0, -2, 3. Keep the solution minimal.',d,quick=False)
 check(j['stages']==['thoth','ptah','maat','sekhmet']);check(command(['python3','-c','from parity import is_even; assert is_even(0); assert is_even(-2); assert not is_even(3)'],d)['exit']==0)
scenario('10-four-agent-pipeline',pipeline)
def chat(d):
 chunks=tui(['/help','What is 19 plus 23? Reply with only the number.','/not-a-command','/version'],d)
 check('42' in chunks[1]); check('Unknown' in chunks[2]);check('RA' in chunks[3])
scenario('11-tui-cloud-chat',chat)
def code_tui(d):
 chunks=tui(['/code Create tui_result.py defining answer() returning 42. Verify it.','/tree','/help'],d)
 check(command(['python3','-c','from tui_result import answer; assert answer()==42'],d)['exit']==0)
scenario('12-tui-code-tree',code_tui)
def moa(d):
 chunks=tui(['/moa Give a concise design review of a pure Python add(a,b) returning a+b. No tools or files needed. Each role must answer briefly.','/help'],d)
 check('MoA synthesis' in chunks[0],chunks[0][-1500:]);check('aggregation model unavailable' not in chunks[0]);check(not list(d.glob('*.py')))
scenario('13-multi-model-moa',moa)
def undo(d):
 (d/'counter.py').write_text('VALUE = 1\n')
 run('Read counter.py. Change VALUE from 1 to 2 using EDIT; then change it from 2 to 3 using a second EDIT. No other files.',d)
 check((d/'counter.py').read_text()=='VALUE = 3\n')
 check(command(['ra','checkpoints'],d)['exit']==0);check(command(['ra','undo'],d)['exit']==0);check((d/'counter.py').read_text()=='VALUE = 1\n')
scenario('14-undo-original',undo)
def failure(d):
 r=command(['ra','run','Create a hello world website','--quick','--json'],d,{'OLLAMA_API_KEY':'invalid-test-key'})
 check(r['exit']!=0);check(not (d/'index.html').exists());j=json.loads(command(['ra','last','--json'],d)['stdout']);check(j['status']=='failed');check(command(['ra','verify'],d)['exit']!=0)
scenario('15-auth-failure-no-placeholder',failure)
def export(d):
 tui(['/help','/version'],d)
 check(command(['ra','sessions'],d)['exit']==0)
 r=command(['ra','export','--out',str(d/'session.md')],d);check(r['exit']==0);check((d/'session.md').exists());check(not key or key not in (d/'session.md').read_text())
scenario('16-session-export',export)
def pipe(d):
 check(command(['ra'],d)['exit']!=0);check(command(['ra','run'],d)['exit']!=0);check(command(['ra','unknown-command'],d)['exit']!=0)
scenario('17-cli-errors',pipe)

def boundary(d):
 outside=base/'outside-marker.txt';outside.write_text('outside marker must stay private')
 (d/'linked.txt').symlink_to(outside)
 chunks=tui(['read linked.txt','/help'],d)
 check('symlink escapes project' in chunks[0]);check('outside marker must stay private' not in chunks[0])
scenario('18-symlink-boundary',boundary)
def readonly(d):
 chunks=tui(['/plan Create forbidden.txt containing 123.','/help'],d)
 check(not (d/'forbidden.txt').exists())
scenario('19-readonly-planner',readonly)
def cancel(d):
 chunks=tui(['<cancel>/code Create a detailed 500-line implementation of a dependency-free chess engine in chess.py. Include full move generation and tests.','/help'],d)
 check('cancel' in chunks[0].lower(),chunks[0][-1000:]);check('commands:' in chunks[1])
scenario('20-tui-cancellation',cancel)
def continuity(d):
 chunks=tui(['Remember the project codename is violet-lantern-91. Reply OK.','What is the project codename I just gave you? Reply only with it.'],d)
 check('violet-lantern-91' in chunks[1])
scenario('21-conversation-context',continuity)

print(f"Acceptance: {sum(r['status']=='PASS' for r in outcomes)}/{len(outcomes)} passed",flush=True)
sys.exit(2 if not outcomes else 1 if any(r['status']!='PASS' for r in outcomes) else 0)
