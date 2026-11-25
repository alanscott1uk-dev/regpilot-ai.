// Exercises an isolated, authenticated Prometheus installation through the workspace collector.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdtemp,rename,rm,writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as wait} from 'node:timers/promises';
import {db} from '../lib/server/db';
import {claimConnector,executeConnector,saveConnector} from '../lib/server/connector-service';
import {customerSourceProof} from '../lib/server/customer-source-proof';
import {assuranceFixture} from '../tests/helpers/assurance-fixture';
import {observationSchema} from '../lib/connectors/observation';

async function main(){
 const binary=process.env.REGPILOT_TEST_PROMETHEUS_BIN;
 if(!binary)throw Error('Set the disposable Prometheus binary path.');
 const dir=await mkdtemp(join(tmpdir(),'regpilot-prometheus-'));
 const web=join(dir,'web.yml'),rules=join(dir,'rules.yml'),config=join(dir,'prometheus.yml');
 async function password(value:string){
  const salt='$2b$05$'+randomBytes(16).toString('hex').slice(0,21)+'.';
  const hashed=execFileSync('perl',['-e','chomp(my $p=<STDIN>);print crypt($p,$ARGV[0])',salt],{input:value+'\n',encoding:'utf8'});
  assert.match(hashed,/^\$2b\$05\$.{53}$/);
  await writeFile(web+'.tmp','basic_auth_users:\n  reader: "'+hashed+'"\n');
  await rename(web+'.tmp',web);
 }
 async function rule(value:number){
  await writeFile(rules+'.tmp','groups:\n- name: distribution\n  interval: 1s\n  rules:\n  - alert: StorageAlarm\n    expr: vector('+value+') > 0\n');
  await rename(rules+'.tmp',rules);
 }
 const first=randomBytes(24).toString('hex'),renewed=randomBytes(24).toString('hex');
 await password(first);await rule(0);await writeFile(config,'global:\n  evaluation_interval: 1s\nrule_files: ["'+rules+'"]\nscrape_configs: []\n');
 const listener=createServer();await new Promise<void>(resolve=>listener.listen(0,'127.0.0.1',resolve));
 const address=listener.address();assert.ok(address&&typeof address==='object');
 await new Promise<void>(resolve=>listener.close(()=>resolve()));
 const origin='http://127.0.0.1:'+address.port;
 const child=spawn(binary,['--config.file='+config,'--web.config.file='+web,'--storage.tsdb.path='+join(dir,'data'),'--web.listen-address=127.0.0.1:'+address.port],{stdio:'ignore'});
 let exited=false;const exit=new Promise<void>(resolve=>{child.once('exit',()=>{exited=true;resolve();});child.once('error',()=>{exited=true;resolve();});});
 const http=globalThis.fetch;
 async function ready(state:string){
  for(let tries=0;tries<100&&!exited;tries++){
   try{
    const response=await http(origin+'/api/v1/rules',{headers:{Authorization:'Basic '+Buffer.from('reader:'+first).toString('base64')},signal:AbortSignal.timeout(1500)});
    const data=await response.json(),current=data.data?.groups?.[0]?.rules?.[0];
    if(current?.health==='ok'&&current.state===state)return;
   }catch{}
   await wait(250);
  }
  throw Error('Prometheus did not evaluate the required rule state.');
 }
 try{
  await ready('inactive');
  const host='prometheus.regpilot.test';
  Object.assign(process.env,{REGPILOT_PROMETHEUS_HOST:host,REGPILOT_WORKSPACE_ENABLED:'true',REGPILOT_CONNECTORS_ENABLED:'true',REGPILOT_CONNECTOR_ENCRYPTION_KEY:randomBytes(32).toString('hex'),SUPABASE_URL:'https://auth.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture'});
  const f=await assuranceFixture();
  try{
   const programme=await db.programmeImport.create({data:{organizationId:f.a.id,createdById:f.o.userId,inputHash:f.a.id,method:'SEARCH',status:'ACCEPTED',evidenceManifest:[]}});
   const control=await db.managedControl.create({data:{organizationId:f.a.id,importId:programme.id,proposalKey:'prometheus-alert',title:'Monitor the storage alert rule',description:'Observe the approved alerting rule',testProcedure:'Collect the current rule evaluation',theme:'quality',ownerId:f.editor.id,scheduledById:f.owner.id,intervalDays:30,nextReviewAt:new Date()}});
   const settings={provider:'PROMETHEUS_ALERT_RULE',controlId:control.id,scope:host,record:'distribution',reference:'StorageAlarm',enabled:true,consent:true,intervalHours:24};
   let connection=await saveConnector(f.o,{...settings,version:0,token:'reader:'+first});
   globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input));assert.equal(url.origin,'https://'+host);assert.equal(init?.method,'GET');assert.equal(url.searchParams.get('exclude_alerts'),'true');
    const response=await http(origin+url.pathname+url.search,init);return new Response(response.body,{status:response.status,headers:response.headers});
   };
   async function dispatch(){
    await db.evidenceConnector.update({where:{id:connection.id},data:{nextRunAt:new Date()}});
    const job=await claimConnector();assert.equal(job?.id,connection.id);
    return executeConnector(job!,undefined,{deferAutomation:true});
   }
   assert.equal(await dispatch(),'OBSERVED');await wait(3000);assert.equal(await dispatch(),'OBSERVED');
   await rule(1);child.kill('SIGHUP');await ready('firing');assert.equal(await dispatch(),'FOLLOW_UP');
   await password(renewed);await dispatch();
   assert.equal((await db.evidenceConnector.findUniqueOrThrow({where:{id:connection.id}})).failureCode,'CREDENTIAL_REJECTED');
   connection=await saveConnector(f.o,{...settings,id:connection.id,version:connection.version,token:'reader:'+renewed});
   assert.equal(await dispatch(),'FOLLOW_UP');
   const proof=await customerSourceProof(f.o,connection.id);
   assert.equal(proof.qualifies,false);assert.equal(proof.depth.reads.length,4);assert.equal(proof.depth.recoveries.length,1);
   assert.ok(proof.depth.failures.find(failure=>failure.code==='CREDENTIAL_REJECTED'&&failure.stage));
   const runs=await db.connectorRun.findMany({where:{organizationId:f.a.id,connectorId:connection.id},orderBy:{capturedAt:'asc'}});
   const checks=runs.map(run=>observationSchema.parse(run.result).checks);
   assert.deepEqual(checks.map(list=>list.find(c=>c.id==='alert-clear')?.observed),['inactive','inactive','firing','firing']);
   const receipt={revision:process.env.REGPILOT_SOURCE_REVISION??execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),product:'Prometheus',environment:'Disposable authenticated installation',customerQualified:proof.qualifies,checks,reads:proof.depth.reads,failures:proof.depth.failures,recoveries:proof.depth.recoveries};
   await writeFile('prometheus-monitoring.json',JSON.stringify(receipt,null,2)+'\n');
   console.log('Prometheus verified two inactive reads, a firing alert, a rejected password and recovery on the same rule.');
  }finally{globalThis.fetch=http;await f.cleanup();}
 }finally{if(!exited){child.kill('SIGTERM');await exit;}await rm(dir,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
