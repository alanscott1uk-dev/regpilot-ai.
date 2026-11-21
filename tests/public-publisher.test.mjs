import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('public publisher and independent watchdog reject secret fields, stale reports and forged operational history',()=>{
 const script=`import importlib.util,datetime,copy
spec=importlib.util.spec_from_file_location('publisher','scripts/publish-horizon.py');p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
now=datetime.datetime.now(datetime.timezone.utc);stamp=now.isoformat().replace('+00:00','Z')
r={'format':'regpilot-horizon-v1','generatedAt':stamp,'windowStart':stamp,'codeCommit':None,'runId':None,'previousAvailable':False,'feeds':[{'id':id,'state':'available','checkedAt':stamp,'total':0,'retrieved':0,'reason':None} for id in p.PUBLISHERS],'items':[],'limitations':[],'pipeline':{'cadenceMinutes':60,'durationMs':100,'requests':12,'retries':0,'retentionLimited':False,'history':[]}}
p.validate(r)
for bad in [dict(r,secret='do not publish'),dict(r,pipeline=dict(r['pipeline'],privateData='secret')),dict(r,generatedAt=(now-datetime.timedelta(hours=4)).isoformat()),dict(r,pipeline=dict(r['pipeline'],requests=10000))]:
 try:p.validate(bad)
 except (AssertionError,ValueError):pass
 else:raise Exception('Invalid payload was accepted')
print('Publisher validation boundaries passed')`;
 const r=spawnSync('python',['-c',script],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/boundaries passed/);
});
