#!/usr/bin/env python3
"""End-user acceptance: invokes installed ra only; never imports RA or runs repo tests."""
import argparse, json, os, pathlib, pty, re, select, subprocess, time, signal, sys
parser=argparse.ArgumentParser()
parser.add_argument('--sandbox',default='/private/tmp/ra-user-sandbox')
parser.add_argument('--key-rtf')
parser.add_argument('--only',default='')
parser.add_argument('--small-model',default='ollama-cloud/gpt-oss:120b')
parser.add_argument('--review-model',default='ollama-cloud/glm-5.3-flash')
a=parser.parse_args(); base=pathlib.Path(a.sandbox); evidence=base/'evidence-agents-70'; evidence.mkdir(exist_ok=True)
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
env['PYTHONDONTWRITEBYTECODE']='1'
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

def data(r,code=0):
 check(r['exit']==code, r['stderr']+'\n'+r['stdout'][-2000:]); return json.loads(r['stdout'])
def cfgfile(name,**updates):
 c=json.loads(config_path.read_text());c.update(updates);p=base/(name+'.json');p.write_text(json.dumps(c));return {'RA_CONFIG':str(p)}
def git(d,*args):
 r=command(['git','-c','core.hooksPath=/dev/null','-c','user.name=RA Acceptance','-c','user.email=acceptance@localhost','-c','commit.gpgsign=false',*args],d)
 check(r['exit']==0,r['stderr']);return r['stdout'].strip()
def seed(d,files=None):
 for name,content in (files or {'README.md':'Sandbox fixture.\n'}).items(): (d/name).write_text(content)
 git(d,'init','-b','main');git(d,'add','.');git(d,'commit','-m','test: seed swarm acceptance')
 return git(d,'rev-parse','HEAD')
def tasksfile(d,tasks):
 p=base/(d.name+'-tasks.json');p.write_text(json.dumps(tasks));return str(p)
def swarm(d,tasks,extra=None,concurrency=2):
 return command(['ra','swarm','run',tasksfile(d,tasks),'--concurrency',str(concurrency),'--json'],d,extra,timeout=240)
def samebase(d,head):
 check(git(d,'rev-parse','HEAD')==head,'Original HEAD changed unexpectedly');check(not git(d,'status','--porcelain'),'Original checkout is dirty')
def retained(d,j):
 for r in j['results']:
  if r.get('worktree'): check(pathlib.Path(r['worktree']).is_dir(),'Worktree lost')
  if r.get('commit'): check(git(d,'rev-parse',r['branch'])==r['commit'],'Task branch lost')

def catalog(d):
 check('ra swarm' in command(['ra','help'],d)['stdout'])
 check('ra.70' in command(['ra','version'],d)['stdout'])
 agents=data(command(['ra','agents','--json'],d)); check(len(agents)>=8 and len({x['role'] for x in agents})==len(agents))
 check({'ptah','thoth','maat','sekhmet'}.issubset({x['role'] for x in agents}))
 check('conflict' in command(['ra','swarm','help'],d)['stdout'])
scenario('22-team-discovery',catalog)

def moa_complete(d):
 (d/'notes.md').write_text('PROJECT_SENTINEL = violet-52\n')
 j=data(command(['ra','moa','Give two concise suggestions for a reliable sum(numbers) function. No tool use necessary.','--roles','thoth,maat','--concurrency','2','--json'],d))
 check(j['status']=='completed' and all(x['status']=='completed' for x in j['results']) and bool(j['synthesis']))
 check(j['stats']['agents']==3 and j['stats']['calls']>=3)
 check([x['role'] for x in j['results']]==['thoth','maat']);check(set(p.name for p in d.iterdir())=={'notes.md'})
scenario('23-bounded-moa',moa_complete)

def moa_partial(d):
 c=json.loads(config_path.read_text());c['agent']['broken']={'model':'ollama-cloud/ra-acceptance-no-such-model'}
 extra=cfgfile('partial-moa',agent=c['agent'])
 j=data(command(['ra','moa','Give one short suggestion for naming a Python sum function. No tools.','--roles','broken,thoth','--concurrency','2','--json'],d,extra),2)
 check(j['status']=='partial');check(j['results'][0]['status']=='failed' and j['results'][0]['error'])
 check(j['results'][1]['status']=='completed' and j['results'][1]['output'] and j['synthesis'])
 check(j['stats']['agents']==3 and not list(d.iterdir()))
scenario('24-partial-moa',moa_partial)

def moa_readonly(d):
 (d/'keep.txt').write_text('untouched\n')
 j=data(command(['ra','moa','Create forbidden.py printing hello and replace keep.txt with changed.','--roles','ptah,maat','--concurrency','2','--json'],d))
 check(j['status']=='completed');check((d/'keep.txt').read_text()=='untouched\n' and not (d/'forbidden.py').exists())
 check(set(p.name for p in d.iterdir())=={'keep.txt'})
scenario('25-moa-readonly',moa_readonly)

def budgets(d):
 extra=cfgfile('one-call',agent_limits={'max_calls':1,'max_agents':8,'max_depth':2,'timeout_ms':120000})
 j=data(command(['ra','moa','Reply with one word. No tools.','--roles','thoth,maat','--concurrency','1','--json'],d,extra),130)
 check(j['status']=='cancelled' and j['stats']['calls']==1);check(j['results'][0]['status']=='completed' and j['results'][1]['status']=='cancelled')
 check('budget' in j['results'][1]['error'].lower() and not j['synthesis'])
scenario('26-shared-call-budget',budgets)

def cancel_moa(d):
 out=tui(['<cancel>/moa Give a detailed architecture review of a distributed SQL database.','/tree','/agents'],d)
 check('cancel' in out[0].lower() or 'abort' in out[0].lower());check('moa' in out[1] and '⏹' in out[1]);check('ptah' in out[2])
 check(not list(d.iterdir()))
scenario('27-moa-tui-cancel',cancel_moa)

def swarm_success(d):
 head=seed(d)
 j=data(swarm(d,[{'id':'sum','prompt':'Create sums.py defining sum_numbers(values) returning sum(values). Verify empty list and [2,3,-1]. No extra files.','files':['sums.py']},{'id':'slug','prompt':'Create slug.py defining slug(text) returning lowercase whitespace-separated words joined with hyphens. Verify empty and repeated spaces. No extra files.','files':['slug.py']}]))
 check(j['status']=='ready' and len(j['results'])==2 and all(x['status']=='ready' for x in j['results']));samebase(d,head);retained(d,j)
 for r in j['results']: check(r['model']=='deepseek-v4-pro:0813')
 listed=data(command(['ra','swarm','list','--json'],d));check(j['id'] in [x['id'] for x in listed])
 got=data(command(['ra','swarm','status',j['id'],'--json'],d));check(got['id']==j['id'])
 applied=data(command(['ra','swarm','apply',j['id'],'--json'],d));check(applied['status']=='applied');retained(d,j)
 check(command(['python3','-B','-c','from sums import sum_numbers; from slug import slug; assert sum_numbers([])==0; assert sum_numbers([2,3,-1])==4; assert slug("  Red  FOX ")=="red-fox"; assert slug("")==""'],d)['exit']==0)
 check(not git(d,'status','--porcelain'));check(git(d,'rev-parse','HEAD')!=head)
 check(data(command(['ra','swarm','apply',j['id'],'--json'],d))['status']=='applied')
scenario('28-swarm-isolated-apply',swarm_success)

def swarm_conflict(d):
 head=seed(d,{'setting.txt':'mode=base\n'})
 j=data(swarm(d,[{'id':v,'prompt':f'Read setting.txt and change its entire content to exactly mode={v} followed by a newline. Only edit this file.','files':['setting.txt']} for v in ('alpha','beta')]))
 check(j['status']=='ready');samebase(d,head)
 applied=data(command(['ra','swarm','apply',j['id'],'--json'],d),1);check(applied['status']=='conflict' and 'setting.txt' in applied['conflicts']);samebase(d,head);retained(d,j)
 check((d/'setting.txt').read_text()=='mode=base\n')
 integration=pathlib.Path(applied['integrationWorktree']);check('<<<<<<<' in (integration/'setting.txt').read_text())
 (integration/'setting.txt').write_text('mode=resolved\n');git(integration,'add','setting.txt');git(integration,'commit','-m','fix: resolve swarm setting conflict')
 recovered=data(command(['ra','swarm','apply',j['id'],'--json'],d));check(recovered['status']=='applied');check((d/'setting.txt').read_text()=='mode=resolved\n');check(not git(d,'status','--porcelain'));retained(d,j)
scenario('29-swarm-conflict-recovery',swarm_conflict)

def validation(d):
 head=seed(d)
 cases=[([{'id':'dup','prompt':'one'},{'id':'dup','prompt':'two'}],2),([{'id':'escape','prompt':'change','files':['../escape']}],2),([{'id':'bad','prompt':'change'}],0)]
 for tasks,n in cases: check(swarm(d,tasks,concurrency=n)['exit']==1)
 for args in [['moa','x','--wat'],['moa','x','--concurrency'],['swarm','run','--cwd'],['swarm','status','../../escape','--json']]:check(command(['ra',*args],d)['exit']==1)
 samebase(d,head);check(data(command(['ra','swarm','list','--json'],d))==[])
 (d/'dirty.txt').write_text('keep me\n');check(swarm(d,[{'id':'x','prompt':'Create x.py'}])['exit']==1);check((d/'dirty.txt').read_text()=='keep me\n')
scenario('30-swarm-validation',validation)

def swarm_partial(d):
 head=seed(d)
 j=data(swarm(d,[{'id':'good','prompt':'Create answer.py containing ANSWER = 42 only.','files':['answer.py']},{'id':'bad','prompt':'Create other.py with X = 2.','model':'ollama-cloud/ra-acceptance-no-such-model','files':['other.py']}]),1)
 check(j['status']=='partial' and j['results'][0]['status']=='ready' and j['results'][1]['status']=='failed');samebase(d,head);retained(d,j)
 check(command(['ra','swarm','apply',j['id'],'--json'],d)['exit']==1);samebase(d,head);check(pathlib.Path(j['results'][0]['worktree'],'answer.py').is_file())
scenario('31-swarm-partial-retained',swarm_partial)

def swarm_tui(d):
 head=seed(d)
 p=tasksfile(d,[{'id':'tui','prompt':'Create banner.py defining BANNER = "copper-moon" only.','files':['banner.py']}])
 out=tui(['/swarm run '+p+' --concurrency 1','/swarm list','/tree'],d)
 check('ready' in out[0] and 'ready' in out[1] and 'swarm' in out[2] and 'ptah' in out[2] and 'deepseek' in out[2]);samebase(d,head)
 j=data(command(['ra','swarm','list','--json'],d))[0];retained(d,j)
 out=tui(['/swarm apply '+j['id'],'/swarm status '+j['id']],d);check('applied' in out[0] and 'applied' in out[1])
 check(command(['python3','-B','-c','from banner import BANNER; assert BANNER=="copper-moon"'],d)['exit']==0)
scenario('32-swarm-tui',swarm_tui)

def swarm_cancel_process(d):
 slow='''import os, pathlib, signal, subprocess, sys, time
child = "import pathlib,signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); pathlib.Path('child-started.txt').write_text('ready'); time.sleep(5); pathlib.Path('orphan.txt').write_text('LEAK')"
subprocess.Popen([sys.executable,'-c',child],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
pathlib.Path('started.pid').write_text(str(os.getpid()))
time.sleep(20)
pathlib.Path('late.txt').write_text('LEAK')
'''
 head=seed(d,{'wait.py':slow})
 tasks=[{'id':'running','prompt':'First run exactly python3 wait.py with BASH and wait for its result. Do not inspect or modify wait.py. Only after this command completes create answer.py with ANSWER=42.','files':['answer.py']},{'id':'queued','prompt':'Create queued.py containing X=1.','files':['queued.py']}]
 args=['ra','swarm','run',tasksfile(d,tasks),'--concurrency','1','--json'];started=time.monotonic()
 p=subprocess.Popen(args,cwd=d,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
 work=None
 try:
  deadline=time.monotonic()+80
  while time.monotonic()<deadline:
   markers=list((d/'.git/ra-swarms').glob('*/worktrees/**/child-started.txt'))
   if markers:work=markers[0].parent;break
   if p.poll() is not None: break
   time.sleep(.1)
  check(work is not None,'Agent never started requested shell fixture')
  p.send_signal(signal.SIGINT);out,err=p.communicate(timeout=12)
  r={'command':args,'exit':p.returncode,'seconds':round(time.monotonic()-started,2),'stdout':clean(out),'stderr':clean(err),'signal':'SIGINT after shell child-started marker'};records.append(r)
  j=data(r,130);check(j['status']=='cancelled');check(j['results'][0]['status']=='cancelled' and j['results'][1]['status']=='cancelled');check(not j['results'][1].get('worktree'))
  time.sleep(6)
  check(not (work/'orphan.txt').exists(),'Cancelled shell leaked a detached child that wrote orphan.txt')
  check(not (work/'late.txt').exists());samebase(d,head);retained(d,j)
 finally:
  if p.poll() is None:os.killpg(p.pid,signal.SIGKILL);out,err=p.communicate();records.append({'command':args,'exit':p.returncode,'stdout':clean(out),'stderr':clean(err)})
  if work and (work/'started.pid').exists():
   try:os.killpg(int((work/'started.pid').read_text()),signal.SIGKILL)
   except ProcessLookupError:pass
scenario('33-swarm-cancel-shell',swarm_cancel_process)

def swarm_ownership(d):
 head=seed(d)
 # Impossible contract: no allowed path differs from base. A legitimate failure must retain the artifact.
 j=data(swarm(d,[{'id':'owned','prompt':'Create wrong.py containing VALUE=7 only. The explicit requested output is wrong.py; report a conflict if the allowed paths prohibit it.','files':['allowed.py']}]),1)
 check(j['status']=='failed');samebase(d,head);retained(d,j)
 check(not j['results'][0].get('commit'))
scenario('34-swarm-ownership-reject',swarm_ownership)

def pipeline_budget(d):
 extra=cfgfile('pipeline-one-call',agent_limits={'max_calls':1,'max_agents':8,'max_depth':2,'timeout_ms':120000})
 r=command(['ra','run','Create answer.py containing ANSWER=42.','--quick','--json'],d,extra)
 check(r['exit']==1 and 'budget' in (r['stdout']+r['stderr']).lower());check(not (d/'answer.py').exists())
 last=data(command(['ra','last','--json'],d,extra));check(last['status']=='failed' and 'budget' in last['error'].lower())
 check(not last['filesWritten'] and len(last['models'])<=1)
scenario('35-pipeline-shared-budget',pipeline_budget)

def swarm_changed_target(d):
 head=seed(d)
 j=data(swarm(d,[{'id':'answer','prompt':'Create answer.py with ANSWER=42 only.','files':['answer.py']}]))
 samebase(d,head)
 (d/'local.txt').write_text('keep local work\n')
 r=command(['ra','swarm','apply',j['id'],'--json'],d);check(r['exit']==1 and 'not clean' in r['stdout'])
 check((d/'local.txt').read_text()=='keep local work\n' and not (d/'answer.py').exists())
 git(d,'add','local.txt');git(d,'commit','-m','test: move target after swarm');moved=git(d,'rev-parse','HEAD')
 r=command(['ra','swarm','apply',j['id'],'--json'],d);check(r['exit']==1 and 'branch moved' in r['stdout'])
 samebase(d,moved);retained(d,j);check(not (d/'answer.py').exists())
scenario('36-swarm-target-guard',swarm_changed_target)

def mixed_swarm(d):
 seed(d)
 tasks=[{'id':'deepseek','prompt':'Create deepseek.py containing MODEL_FAMILY="deepseek" only.','files':['deepseek.py'],'model':'ollama-cloud/deepseek-v4-pro:0813'},{'id':'glm','prompt':'Create glm.py containing MODEL_FAMILY="glm" only.','files':['glm.py'],'model':'ollama-cloud/glm-5.3-flash'}]
 j=data(command(['ra','swarm','run',tasksfile(d,tasks),'--concurrency','2','--merge','--json'],d))
 check(j['status']=='applied');check({r['model'] for r in j['results']}=={'deepseek-v4-pro:0813','glm-5.3-flash'})
 check(command(['python3','-B','-c','import deepseek,glm; assert deepseek.MODEL_FAMILY=="deepseek"; assert glm.MODEL_FAMILY=="glm"'],d)['exit']==0)
 check(not git(d,'status','--porcelain'));retained(d,j)
scenario('37-mixed-model-swarm',mixed_swarm)

summary={'pass':sum(x['status']=='PASS' for x in outcomes),'fail':sum(x['status']=='FAIL' for x in outcomes),'scenarios':[{k:v for k,v in x.items() if k!='terminal'} for x in outcomes]}
(evidence/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary),flush=True)
sys.exit(1 if summary['fail'] else 0)
