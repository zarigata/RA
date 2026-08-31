#!/usr/bin/env python3
"""End-user acceptance for explicit model fallbacks: invokes installed ra only."""
import argparse, json, os, pathlib, pty, re, select, subprocess, time, signal, sys
parser=argparse.ArgumentParser()
parser.add_argument('--sandbox',default='/private/tmp/ra-user-sandbox')
parser.add_argument('--key-rtf')
parser.add_argument('--only',default='')
parser.add_argument('--small-model',default='ollama-cloud/glm-5.3-flash')
a=parser.parse_args(); base=pathlib.Path(a.sandbox); evidence=base/'evidence-fallback'; evidence.mkdir(exist_ok=True)
env=dict(os.environ,HOME=str(base/'home'),PATH=str(base/'bin')+':'+os.environ['PATH'],TERM='xterm-256color',RA_SMALL_MODEL=a.small_model,OLLAMA_LAN_URL='http://127.0.0.1:9',OLLAMA_LOCAL_URL='http://127.0.0.1:9')
config=json.loads((base/'app/anubis/ra.json').read_text())
config['profile']='cloud-acceptance'
config.pop('tier_models',None)
# Per-scenario RA_MODEL/RA_FALLBACK environment overrides select the primary and
# fallback models; exported env takes precedence over role entries in the config.
config_path=base/'cloud-acceptance.json'
config_path.write_text(json.dumps(config,indent=2)+'\n')
env['RA_CONFIG']=str(config_path)
env['PYTHONDONTWRITEBYTECODE']='1'
env['TMPDIR']=str(base)
if a.key_rtf:
 raw=subprocess.check_output(['textutil','-convert','txt','-stdout',a.key_rtf],text=True)
 env['OLLAMA_API_KEY']=re.search(r'OLLAMA\s*:\s*(\S+)',raw).group(1)
key=env.get('OLLAMA_API_KEY','')
ansi=re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]')
def clean(s): return ansi.sub('',s).replace(key,'[REDACTED]') if key else ansi.sub('',s)
records=[]; outcomes=[]
MISSING='ollama-cloud/ra-acceptance-missing-model'

def fresh(name):
 d=base/'projects'/f'fb-{name}-{int(time.time())}'; d.mkdir(parents=True,exist_ok=True); return d

def scenario(sid,fn,extra):
 if a.only and sid.split('-')[0] not in a.only.split(','): return
 d=fresh(sid); out={'scenario':sid}
 t0=time.monotonic()
 try:
  fn(d,extra); out['status']='PASS'
 except Exception as e:
  out['status']='FAIL'; out['error']=str(e)[-1500:]
 out['seconds']=round(time.monotonic()-t0,2)
 (evidence/f'{sid}.json').write_text(json.dumps({**out,'records':[r for r in records if r.get('scenario')==sid]},indent=1))
 outcomes.append(out); print(f"{sid}: {out['status']} ({out['seconds']}s) {out.get('error','')[:300]}",flush=True)

def command(args,cwd,extra=None,timeout=240,sid=''):
 start=time.monotonic()
 p=subprocess.Popen(args,cwd=cwd,env={**env,**(extra or {})},stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
 try: o,er=p.communicate(timeout=timeout)
 except subprocess.TimeoutExpired:
  os.killpg(p.pid,signal.SIGKILL); o,er=p.communicate(); er+='\nTIMEOUT'
 r={'scenario':sid,'command':args,'exit':p.returncode,'seconds':round(time.monotonic()-start,2),'stdout':clean(o),'stderr':clean(er)}
 records.append(r); return r

def tui(inputs,cwd,extra=None,sid='',timeout=240):
 master,slave=pty.openpty()
 p=subprocess.Popen(['ra','--cwd',str(cwd)],stdin=slave,stdout=slave,stderr=slave,cwd=cwd,env={**env,**(extra or {})},start_new_session=True)
 transcript=b''; chunks=[]
 def read_prompt(t=timeout):
  nonlocal transcript
  buf=b''; deadline=time.monotonic()+t
  while time.monotonic()<deadline:
   if select.select([master],[],[],0.2)[0]:
    try: data=os.read(master,65536)
    except OSError: break
    if not data: break
    buf+=data; transcript+=data
    plain=ansi.sub('',buf.decode(errors='replace'))
    if re.search(r'RA › $',plain): return plain
   if p.poll() is not None: break
  raise AssertionError('TUI did not return to prompt: '+clean(buf.decode(errors='replace'))[-1200:])
 try:
  read_prompt()
  for text in inputs:
   os.write(master,(text+'\r').encode()); chunks.append(read_prompt())
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
  p.wait(timeout=5)
 finally:
  if p.poll() is None:
   try: os.killpg(p.pid,signal.SIGKILL); p.wait(5)
   except Exception: pass
  os.close(master)
 records.append({'scenario':sid,'command':'ra (TUI)','transcript':clean(transcript.decode(errors='replace'))[-6000:]})
 return [clean(c) for c in chunks]

def check(cond,msg=''):
 if not cond: raise AssertionError(msg or 'check failed')

def fb_cli(d,extra):
 r=command(['ra','run','Create add.py defining add(a,b) returning a+b and a __main__ block printing add(2,3).','--quick','--verify','--json'],d,extra,sid='61')
 check(r['exit']==0,f"exit={r['exit']} stderr={r['stderr'][-600:]}")
 check((d/'add.py').exists(),'add.py missing')
 check('RA fallback' in r['stderr'],'no fallback attribution in stderr: '+r['stderr'][-400:])
 check(MISSING.split('/')[-1] in r['stderr'] and extra['RA_FALLBACK'].split('/')[-1] in r['stderr'],'attribution names both models: '+r['stderr'][-400:])
 last=json.loads(command(['ra','last','--json'],d,extra,sid='61')['stdout'])
 fbs=[f for o in last.get('outputs',[]) for f in (o.get('fallbacks') or [])]
 check(any(f.get('to')==extra['RA_FALLBACK'].split('/')[-1] for f in fbs),'fallbacks missing from ra last --json outputs')

def fb_default_chain(d,extra):
 r=command(['ra','run','Create mul.py defining mul(a,b) returning a*b and a __main__ block printing mul(3,4).','--quick','--verify','--json'],d,extra,sid='62')
 check(r['exit']==0,f"exit={r['exit']} stderr={r['stderr'][-600:]}")
 check((d/'mul.py').exists(),'mul.py missing')
 check('gpt-oss:120b' in r['stderr'],'default-chain candidate not attributed: '+r['stderr'][-400:])

def fb_auth(d,extra):
 r=command(['ra','run','Create auth.py with VALUE=1.','--quick','--verify','--json'],d,extra,sid='63',timeout=120)
 check(r['exit']!=0,'auth failure must not succeed via fallback')
 check(not (d/'auth.py').exists(),'artifact written despite auth failure')
 check('RA fallback' not in r['stderr'],'auth failure must not trigger fallback attribution')
 last=json.loads(command(['ra','last','--json'],d,extra,sid='63')['stdout'])
 check(last.get('status')=='failed','last run not marked failed')

def fb_tui(d,extra):
 chunks=tui(['/code Create tui_fb.py defining answer() returning 42.','/help'],d,extra,sid='64')
 check(command(['python3','-c','from tui_fb import answer; assert answer()==42'],d,extra,sid='64')['exit']==0,'generated module failed check')
 plain=' '.join(chunks)
 check('fallback' in plain.lower(),'TUI transcript lacks fallback notice')

s1=fresh('61'); s2=fresh('62'); s3=fresh('63'); s4=fresh('64')
os.makedirs(s1,exist_ok=True); os.makedirs(s2,exist_ok=True); os.makedirs(s3,exist_ok=True); os.makedirs(s4,exist_ok=True)
scenario('61-fallback-attribution-cli',lambda d,extra: fb_cli(d,extra),{'RA_MODEL':MISSING,'RA_FALLBACK':'ollama-cloud/glm-5.3-flash'})
scenario('62-fallback-default-chain',lambda d,extra: fb_default_chain(d,extra),{'RA_MODEL':MISSING})
cfg2=json.loads(config_path.read_text()); cfg2['fallbacks']={'default':['ollama-cloud/gpt-oss:120b']}
config_path.write_text(json.dumps(cfg2,indent=2)+'\n')
scenario('63-auth-no-fallback',lambda d,extra: fb_auth(d,extra),{'RA_MODEL':MISSING,'OLLAMA_API_KEY':'invalid-acceptance-key'})
scenario('64-fallback-tui',lambda d,extra: fb_tui(d,extra),{'RA_MODEL':MISSING,'RA_FALLBACK':'ollama-cloud/glm-5.3-flash'})
print(f"Fallback acceptance: {sum(o['status']=='PASS' for o in outcomes)}/{len(outcomes)} passed",flush=True)
sys.exit(2 if not outcomes else 1 if any(o['status']!='PASS' for o in outcomes) else 0)
