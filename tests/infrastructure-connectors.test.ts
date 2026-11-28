import test from 'node:test';
import assert from 'node:assert/strict';
import {collectVercel,collectSupabase} from '../lib/connectors/infrastructure';
import {collectConfiguredConnector} from '../lib/server/connector-service';
const token='fictional-dedicated-read-only-token',v={projectId:'prj_CaseSensitive123',teamId:'team_CaseSensitive123'},s={projectRef:'abcdefghijklmnopqrst',providerOrganizationId:'orgabcdefghijklmnopq'};
test('Vercel verifies project/team and retains only explicit configuration observations',async()=>{
 const result=await collectVercel(v,token,async(u,o)=>{assert.equal(u,'https://api.vercel.com/v9/projects/'+v.projectId+'?teamId='+v.teamId);assert.equal(o?.method,'GET');return Response.json({id:v.projectId,accountId:v.teamId,gitForkProtection:true,ssoProtection:{deploymentType:'preview'},env:[{value:'DO NOT SAVE'}],link:{deployHooks:[{url:'SECRET'}]}})});
 assert.equal(result.checks.find(c=>c.id==='fork-protection')?.status,'PASS');assert.equal(result.checks.find(c=>c.id==='application-authentication')?.status,'UNKNOWN');assert.doesNotMatch(JSON.stringify(result),/DO NOT SAVE|SECRET|fictional-dedicated/);
 await assert.rejects(()=>collectVercel(v,token,async()=>Response.json({id:v.projectId,accountId:'team_Other123456789'})),(e:any)=>e.code==='TARGET_MISMATCH');
 const missing=await collectVercel(v,token,async()=>Response.json({id:v.projectId,accountId:v.teamId}));assert.equal(missing.checks.filter(c=>c.status==='UNKNOWN').length,3);
});
test('Supabase verifies scope before SSL reads, requires applied state and excludes database rows',async()=>{
 let calls=0;const project={id:s.projectRef,organization_id:s.providerOrganizationId,status:'ACTIVE_HEALTHY',database:{host:'DO NOT SAVE'},keys:['SECRET']};
 const get=(ssl:unknown):typeof fetch=>async(u,o)=>{calls++;assert.equal(o?.method,'GET');assert.ok(String(u).startsWith('https://api.supabase.com/v1/projects/'+s.projectRef));return Response.json(String(u).endsWith('/ssl-enforcement')?ssl:project)};
 let r=await collectSupabase(s,token,get({currentConfig:{database:true},appliedSuccessfully:true}));assert.equal(calls,2);assert.equal(r.checks.find(c=>c.id==='database-tls')?.status,'PASS');assert.doesNotMatch(JSON.stringify(r),/DO NOT SAVE|SECRET/);
 r=await collectSupabase(s,token,get({currentConfig:{database:true},appliedSuccessfully:false}));assert.equal(r.checks.find(c=>c.id==='database-tls')?.status,'UNKNOWN');
 r=await collectSupabase(s,token,async u=>String(u).endsWith('/ssl-enforcement')?new Response(null,{status:403}):Response.json(project));assert.equal(r.checks.find(c=>c.id==='database-tls')?.status,'UNKNOWN');
 calls=0;await assert.rejects(()=>collectSupabase(s,token,async()=>{calls++;return Response.json({...project,organization_id:'other'})}),(e:any)=>e.code==='TARGET_MISMATCH');assert.equal(calls,1);
});
test('new infrastructure adapters remain gated and invalid targets cannot send credentials',async()=>{
 process.env.REGPILOT_CONNECTORS_ENABLED='false';for(const provider of ['VERCEL','SUPABASE'])await assert.rejects(()=>collectConfiguredConnector({provider,repository:'invalid',branch:'invalid'},token),(e:any)=>e.code==='PROVIDER_DISABLED');
 await assert.rejects(()=>collectVercel({...v,projectId:'https://evil.invalid'},token,async()=>assert.fail()));
 await assert.rejects(()=>collectSupabase(s,'bad\ncredential',async()=>assert.fail()));
});
