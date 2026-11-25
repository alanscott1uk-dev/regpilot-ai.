// Provision and exercise only the two disposable loopback services started by this CI job.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {setTimeout as wait} from 'node:timers/promises';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {db} from '../lib/server/db';
import {claimConnector,executeConnector,saveConnector} from '../lib/server/connector-service';
import {customerSourceProof} from '../lib/server/customer-source-proof';
import {assuranceFixture} from '../tests/helpers/assurance-fixture';
import {observationSchema,observationOutcome} from '../lib/connectors/observation';

async function main(){
 const password=process.env.REGPILOT_TEST_APP_PASSWORD;
 if(!password)throw Error('Disposable setup password unavailable');
 const gitea='http://127.0.0.1:8193',grafana='http://127.0.0.1:8194',user='quality-reader';
 const auth=(name:string)=>'Basic '+Buffer.from(name+':'+password).toString('base64');
 const api=async(origin:string,path:string,method:string,data?:unknown)=>{
  const res=await fetch(origin+path,{method,redirect:'error',headers:{Authorization:auth(origin===gitea?user:'admin'),'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});
  assert.ok(res.ok,method+' '+path+' returned '+res.status);
  const text=await res.text();return text?JSON.parse(text):null;
 };
 const repo=user+'/quality-config';
 await api(gitea,'/api/v1/user/repos','POST',{name:'quality-config',private:true,auto_init:true,default_branch:'main'});
 const gt=(name:string)=>api(gitea,'/api/v1/users/'+user+'/tokens','POST',{name,scopes:['read:repository']});
 const sa=await api(grafana,'/api/serviceaccounts','POST',{name:'regpilot-read',role:'Viewer'});
 const tokenPath='/api/serviceaccounts/'+sa.id+'/tokens',dashboard='quality-monitor';
 const gf=(name:string)=>api(grafana,tokenPath,'POST',{name});
 const publish=(version:number)=>api(grafana,'/api/dashboards/db','POST',{dashboard:{uid:dashboard,title:'Quality monitoring',schemaVersion:39,version,panels:[],tags:['revision-'+version]},overwrite:version>0});
 const created=await publish(0);
 const gitToken=await gt('first-read'),grafToken=await gf('first-read');
 process.env.REGPILOT_GITEA_HOST='gitea.regpilot.test';process.env.REGPILOT_GRAFANA_HOST='grafana.regpilot.test';
 const http=globalThis.fetch;
 const transport:typeof fetch=async(input,init)=>{
  const uri=new URL(String(input)),origins:Record<string,string>={'https://gitea.regpilot.test':gitea,'https://grafana.regpilot.test':grafana};
  if(uri.origin===gitea||uri.origin===grafana)return http(input,init);
  assert.ok(origins[uri.origin]);assert.equal(init?.method,'GET');
  const res=await http(origins[uri.origin]+uri.pathname+uri.search,init);
  return new Response(res.body,{status:res.status,headers:res.headers});
 };
 assert.equal(sa.orgId,1);assert.equal(created.version,1);
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'true',REGPILOT_CONNECTORS_ENABLED:'true',REGPILOT_CONNECTOR_ENCRYPTION_KEY:randomBytes(32).toString('hex'),SUPABASE_URL:'https://auth.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture'});
 const f=await assuranceFixture();
 try{
 const programme=await db.programmeImport.create({data:{organizationId:f.a.id,createdById:f.o.userId,inputHash:f.a.id,method:'SEARCH',status:'ACCEPTED',evidenceManifest:[]}});
 const control=await db.managedControl.create({data:{organizationId:f.a.id,importId:programme.id,proposalKey:'business-application',title:'Monitor application configuration',description:'Inspect the approved source',testProcedure:'Read the configured record',theme:'quality',ownerId:f.editor.id,scheduledById:f.owner.id,intervalDays:30,nextReviewAt:new Date()}});
 const settings={controlId:control.id,version:0,enabled:true,consent:true,intervalHours:24};
 const configs=[{...settings,provider:'GITEA_REPOSITORY',scope:'gitea.regpilot.test',record:repo,reference:'main'},{...settings,provider:'GRAFANA_DASHBOARD',scope:'grafana.regpilot.test',record:dashboard,reference:sa.orgId+'/'+created.version}];
 const connections=await Promise.all(configs.map((c,i)=>saveConnector(f.o,{...c,token:[gitToken.sha1,grafToken.key][i]})));
 globalThis.fetch=transport;
 async function dispatch(fail=false){
  // Bring the disposable schedules due for each wall-clock slot. The production 24-hour qualification is unchanged.
  await db.evidenceConnector.updateMany({where:{organizationId:f.a.id},data:{nextRunAt:new Date()}});
  const ids=new Set<string>();
  for(const _ of connections){
   const job=await claimConnector();assert.ok(job&&job.organizationId===f.a.id&&!ids.has(job.id));ids.add(job.id);
   await executeConnector(job,undefined,{deferAutomation:true});
  }
  assert.equal(ids.size,2);
  if(fail)for(const c of connections){const actual=await db.evidenceConnector.findUniqueOrThrow({where:{id:c.id}});assert.equal(actual.failureCode,'CREDENTIAL_REJECTED');}
 }
 async function both(){await dispatch();return Promise.all(connections.map(async c=>{
  const source=await db.evidenceConnector.findUniqueOrThrow({where:{id:c.id}});assert.equal(source.failureCode,null);
  const run=await db.connectorRun.findFirstOrThrow({where:{connectorId:c.id,configVersion:source.version},orderBy:{capturedAt:'desc'}});
  return observationSchema.parse(run.result);
 }));}
 const interval=15_000,start=Date.now();
 async function due(slot:number){await wait(Math.max(0,start+slot*interval-Date.now()));}
 const first=await both();
 await due(1);const repeat=await both();
 for(const pair of [first,repeat]){
  assert.equal(pair[0].checks.find(c=>c.id==='protected')?.status,'FAIL');assert.equal(observationOutcome(pair[1]),'OBSERVED');
 }
 await api(gitea,'/api/v1/repos/'+repo+'/branch_protections','POST',{rule_name:'main',branch_name:'main',enable_push:false});
 await publish(created.version);
 await due(2);const changed=await both();
 assert.equal(observationOutcome(changed[0]),'OBSERVED');assert.equal(changed[1].checks[0].status,'FAIL');
 await api(gitea,'/api/v1/users/'+user+'/tokens/'+gitToken.id,'DELETE');await api(grafana,tokenPath+'/'+grafToken.id,'DELETE');
 await due(3);
 await dispatch(true);
 const retired=await Promise.all(connections.map(async c=>{
  const event=await db.auditEvent.findFirstOrThrow({where:{entityId:c.id,organizationId:f.a.id,action:'connector.collection_failed'}});
  return {at:event.createdAt,details:event.details};
 }));
 const nextGit=await gt('renewed-read'),nextGraf=await gf('renewed-read');
 for(const [i,c] of connections.entries())await saveConnector(f.o,{...configs[i],id:c.id,version:c.version,token:[nextGit.sha1,nextGraf.key][i]});
 await due(4);const restored=await both();
 const workspace=await Promise.all(connections.map(async c=>{
  const trace=await customerSourceProof(f.o,c.id);
  assert.equal(trace.qualifies,false);assert.equal(trace.depth.reads.length,4);assert.equal(trace.depth.recoveries.length,1);assert.ok(trace.depth.failures[0].stage);
  return {reads:trace.depth.reads,failures:trace.depth.failures,recoveries:trace.depth.recoveries,customerQualified:trace.qualifies};
 }));
 assert.deepEqual(restored.map(r=>r.checks),changed.map(r=>r.checks));
 await writeFile('business-application-recovery.json',JSON.stringify({revision:process.env.REGPILOT_SOURCE_REVISION??execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),environment:'Disposable CI installations',intervalSeconds:interval/1000,
  applications:['Gitea','Grafana'].map((product,i)=>({product,first:first[i],repeat:repeat[i],changed:changed[i],retired:retired[i],renewed:restored[i],workspace:workspace[i]}))},null,2));
 console.log('Both installations returned two timed observations, a control change, a rejected retired credential and a successful read under the renewed credential.');
 }finally{globalThis.fetch=http;await f.cleanup();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
