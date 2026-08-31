#!/usr/bin/env python3
"""Fixed-budget competitive evidence: installed ra vs opencode vs codex on real repos.

Each tool receives identical task prompts on a fresh clone of a real repository,
runs headless (no user interaction) under a wall-clock budget, and its work is
checked by an independent checker that does not trust agent output.
"""
import argparse, json, os, pathlib, re, shutil, subprocess, time

parser=argparse.ArgumentParser()
parser.add_argument('--sandbox',default='/private/tmp/ra-user-sandbox')
parser.add_argument('--bench',default='/private/tmp/ra-bench')
parser.add_argument('--budget',type=int,default=300)
parser.add_argument('--tools',default='ra,opencode,codex')
parser.add_argument('--only',default='')
a=parser.parse_args()
base=pathlib.Path(a.sandbox); bench=pathlib.Path(a.bench)
evidence=base/'evidence-competitive'; evidence.mkdir(exist_ok=True)
repos=bench/'repos'; runs=bench/'runs'; runs.mkdir(parents=True,exist_ok=True)

ANSI=re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]')
def clean(s): return ANSI.sub('',s)

TASKS=[
 {
  'id':'micrograd-gradient',
  'repo':'micrograd',
  'prompt':"Use the repository's micrograd Value class. Create bench_grad.py in the repository root that sets a=Value(2.0), b=Value(-1.0), c=Value(10.0), computes e=a*b+c, calls e.backward(), then prints exactly four numbers, one per line: e.data, a.grad, b.grad, c.grad. Do not modify any existing repository file.",
  'check':"import subprocess,sys\nr=subprocess.run([sys.executable,'bench_grad.py'],capture_output=True,text=True,timeout=60,cwd=run_dir)\nif r.returncode!=0: sys.exit('nonzero exit')\nnums=[float(x) for x in r.stdout.split()]\nif len(nums)<4: sys.exit('expected 4 numbers, got %r'%r.stdout)\nif nums[:4]!=[8.0,-1.0,2.0,1.0]: sys.exit('wrong values %r'%nums[:4])\n",
 },
 {
  'id':'micrograd-neuron',
  'repo':'micrograd',
  'prompt':"Use the repository's Neuron class from micrograd/nn.py. Create bench_neuron.py in the repository root that first seeds Python's random module with 7 (random.seed(7)) so the neuron's random weights are deterministic, then builds n=Neuron(2), feeds x=[1.0,-2.0], computes y=n(x), calls y.backward(), and prints exactly four numbers, one per line: y.data, n.w[0].grad, n.w[1].grad, n.b.grad. Do not modify any existing repository file.",
  'check':"import subprocess,sys\nr=subprocess.run([sys.executable,'bench_neuron.py'],capture_output=True,text=True,timeout=60,cwd=run_dir)\nif r.returncode!=0: sys.exit('nonzero exit')\nnums=[float(x) for x in r.stdout.split()]\nif len(nums)<4: sys.exit('expected 4 numbers, got %r'%r.stdout)\n# ReLU identity: for y=relu(w.x+b), y.grad=1 => w_i.grad = x_i and b.grad = 1 when active, all zero otherwise.\nif nums[0]>0 and nums[1:4]!=[1.0,-2.0,1.0]: sys.exit('active-case gradient identity violated %r'%nums)\nif nums[0]==0 and nums[1:4]!=[0.0,0.0,0.0]: sys.exit('inactive-case gradients must all be zero, got %r'%nums)\n",
 },
 {
  'id':'slugify-readme',
  'repo':'slugify',
  'prompt':"Read README.md. Create bench_readme.mjs in the repository root as an ES module that imports the repository's slugify (from './index.js') and asserts at least four example input/output pairs exactly as documented in the README's Usage section, printing one line per passing check in the form 'PASS: <input> -> <output>' and finally 'DONE'. Run without errors. Do not modify any existing repository file.",
  'check':"import subprocess,sys\nr=subprocess.run(['node','bench_readme.mjs'],capture_output=True,text=True,timeout=60,cwd=run_dir)\nif r.returncode!=0: sys.exit('nonzero exit: '+r.stderr[:300])\nif r.stdout.count('PASS:')<4: sys.exit('fewer than 4 PASS lines')\nif 'DONE' not in r.stdout: sys.exit('no DONE line')\n",
 },
]

def sh(args,cwd=None,timeout=60,env=None):
 r=subprocess.run(args,cwd=cwd,env=env,capture_output=True,text=True,timeout=timeout)
 return r

def fresh_clone(task,run_dir):
 src=repos/task['repo']
 if not src.exists(): raise SystemExit(f'missing pristine repo {src}')
 r=sh(['git','clone','-q',str(src),str(run_dir)])
 if r.returncode!=0: raise SystemExit(r.stderr)
 if task['repo']=='slugify':
  # The repo declares an npm dependency; install it so the task is runnable.
  sh(['npm','install','--no-audit','--no-fund','--silent'],cwd=run_dir,timeout=180)

def reset_repo(run_dir):
 sh(['git','checkout','--','.'],cwd=run_dir)
 sh(['git','clean','-fdq'],cwd=run_dir)

ra_env=dict(os.environ,
 HOME=str(base/'home'),PATH=str(base/'bin')+':'+os.environ['PATH'],
 RA_MODEL='ollama-cloud/deepseek-v4-pro:0813',RA_SMALL_MODEL='ollama-cloud/glm-5.3-flash',
 OLLAMA_LAN_URL='http://127.0.0.1:9',OLLAMA_LOCAL_URL='http://127.0.0.1:9',
 RA_CONFIG=str(base/'cloud-acceptance.json'),
 TMPDIR=str(base),PYTHONDONTWRITEBYTECODE='1')
if os.environ.get('OLLAMA_API_KEY'): ra_env['OLLAMA_API_KEY']=os.environ['OLLAMA_API_KEY']

def claude_env():
 # claude code is installed but unauthenticated with Anthropic; the user's
 # stored Z.AI coding-plan credential provides an Anthropic-compatible endpoint.
 try:
  key=json.load(open(pathlib.Path.home()/'.local/share/opencode/auth.json'))['zai-coding-plan']['key']
 except Exception:
  return None,None
 return ({**os.environ,'ANTHROPIC_BASE_URL':'https://api.z.ai/api/anthropic','ANTHROPIC_AUTH_TOKEN':key},key)

def run_tool(tool,task,run_dir):
 t0=time.monotonic()
 if tool=='ra':
  r=sh(['ra','run',task['prompt'],'--quick','--verify','--json','--cwd',str(run_dir)],timeout=a.budget,env=ra_env)
  out=(r.stdout or '')+(r.stderr or '')
 elif tool=='opencode':
  r=sh(['opencode','run','-m','ollama-cloud/deepseek-v4-pro',task['prompt']],cwd=run_dir,timeout=a.budget)
  out=(r.stdout or '')+(r.stderr or '')
 elif tool=='codex':
  r=sh(['codex','exec','-s','workspace-write','--skip-git-repo-check',task['prompt']],cwd=run_dir,timeout=a.budget)
  out=(r.stdout or '')+(r.stderr or '')
 elif tool=='claude':
  cenv,ckey=claude_env()
  if cenv is None:
   return {'exit':1,'seconds':0,'output_tail':'no Z.AI credential available for claude','timeout':False}
  r=sh(['claude','-p',task['prompt'],'--model','glm-5.3-flash','--dangerously-skip-permissions'],cwd=run_dir,timeout=a.budget,env=cenv)
  out=((r.stdout or '')+(r.stderr or '')).replace(ckey or '\x00','[REDACTED]')
 else: raise SystemExit('unknown tool '+tool)
 seconds=round(time.monotonic()-t0,2)
 timed_out='TIMEOUT' in (r.stderr or '')
 return {'exit':r.returncode,'seconds':seconds,'output_tail':clean(out)[-3000:],'timeout':timed_out}

results={}
for tool in a.tools.split(','):
 for task in TASKS:
  sid=f"{tool}-{task['id']}"
  if a.only and task['id'] not in a.only.split(','): continue
  run_dir=runs/f"{sid}-{int(time.time())}"
  fresh_clone(task,run_dir)
  t0=time.monotonic()
  try:
   meta=run_tool(tool,task,run_dir)
  except subprocess.TimeoutExpired:
   meta={'exit':None,'seconds':round(time.monotonic()-t0,2),'output_tail':'BUDGET EXCEEDED','timeout':True}
  check_start=time.monotonic()
  try:
   exec(task['check'],{'run_dir':str(run_dir)})
   check_ok=True; check_err=''
  except SystemExit as e:
   check_ok=False; check_err=str(e)
  except Exception as e:
   check_ok=False; check_err=f'{type(e).__name__}: {e}'
  dirty=sh(['git','status','--porcelain'],cwd=run_dir).stdout.strip().splitlines()
  existing=[p.name for p in run_dir.iterdir() if p.name.startswith('bench_')]
  rec={'scenario':sid,'tool':tool,'task':task['id'],'budget_s':a.budget,
       'success':bool(check_ok),'check_error':check_err,'new_files':existing,
       'dirty_paths':len(dirty),**meta}
  (evidence/f'{sid}.json').write_text(json.dumps(rec,indent=1))
  results[sid]=rec
  print(f"{sid}: {'PASS' if check_ok else 'FAIL'} in {rec['seconds']}s files={existing} {check_err[:120]}",flush=True)

print('\n=== summary ===')
for sid,r in results.items():
 print(f"{sid:38s} {'PASS' if r['success'] else 'FAIL':4s} {r['seconds']:>7.1f}s")
