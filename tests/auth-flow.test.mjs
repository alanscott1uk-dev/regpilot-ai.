import test from 'node:test';
import assert from 'node:assert/strict';
import {callbackInfo,cleanAuthUrl,signInDestination,homeDestination,authProblem,cooldownSeconds,resolveSignInReturn} from '../lib/auth-flow.mjs';

test('return destinations cannot send credentials to an external host or demo',()=>{
 for(const path of ['https://evil.invalid','//evil.invalid','/team/../../evil','/team?next=https://evil.invalid','/register','/workbench','/team\\evil','/team/%2e%2e/evil'])assert.equal(signInDestination(path),'/team');
 for(const path of ['/team','/team/settings','/ai','/auditor','/trust','/team/people'])assert.equal(signInDestination(path),path);
});
test('home preserves the one-use code and flow id, never tokens or supplied redirects',()=>{
 assert.equal(homeDestination({code:'fixture code',sb_flow_id:'fixture-id',next:'https://evil.invalid',access_token:'secret'}),'/team?code=fixture+code&sb_flow_id=fixture-id');
 assert.equal(homeDestination({code:['one','two']}),'/team/operations');
 assert.equal(homeDestination({code:'a'.repeat(2049)}),'/team/operations');
 assert.equal(homeDestination({}),'/team/operations');
});
test('callback metadata excludes credentials and handles expired links in query or fragment',()=>{
 assert.equal(callbackInfo('?view=programme','#controls'),null);
 assert.equal(callbackInfo('?code=fixture-secret').hasCode,true);
 assert.equal(callbackInfo('','#error=access_denied&error_code=otp_expired').hasError,true);
 assert.equal(callbackInfo('','#access_token=fixture-secret&refresh_token=another').legacy,true);
 assert.doesNotMatch(JSON.stringify(callbackInfo('?code=fixture-secret')),/fixture-secret/);
 assert.equal(cleanAuthUrl('https://pilot.invalid/register?code=secret&sb_flow_id=id&view=all#controls'),'/register?view=all#controls');
 assert.equal(cleanAuthUrl('https://pilot.invalid/ai#error=denied&error_description=secret&access_token=token&refresh_token=token'),'/ai');
 assert.equal(cleanAuthUrl('https://pilot.invalid/team?view=all#access_token=secret&refresh_token=another&state=ordinary'),'/team?view=all#state=ordinary');
 assert.equal(cleanAuthUrl('https://pilot.invalid/team?code=secret#section-one'),'/team#section-one');
 assert.equal(cleanAuthUrl('https://pilot.invalid/team#section-one'),'/team#section-one');
 assert.equal(cleanAuthUrl('https://pilot.invalid/team#access_token=secret&refresh_token=another'),'/team');
});
test('provider errors have actionable fixed messages and bounded retry windows',()=>{
 assert.equal(authProblem({code:'over_email_send_rate_limit'}).seconds,3600);
 assert.equal(authProblem({status:429}).seconds,60);
 assert.equal(authProblem({code:'otp_expired'}).kind,'expired');
 assert.equal(authProblem({code:'pkce_verifier_missing'}).kind,'browser');
 assert.doesNotMatch(authProblem({message:'secret https://evil.invalid'}).message,/secret|evil/);
 assert.equal(cooldownSeconds(NaN,0),0);assert.equal(cooldownSeconds(Infinity,0),0);
 assert.equal(cooldownSeconds(1000,1001),0);assert.equal(cooldownSeconds(1501,1000),1);
 assert.equal(cooldownSeconds(1e12,0),3600);
});
function fixture({initError=null,session={},user={},userError=null}={}){
 const calls=[];return {calls,auth:{initialize:async()=>{calls.push('initialize');return {error:initError};},getSession:async()=>{calls.push('session');return {data:{session},error:null};},getUser:async()=>{calls.push('user');return {data:{user},error:userError};}}};
}
const info=callbackInfo('?code=fixture-code');
test('a demo callback is recovered only after initialization and remote user verification',async()=>{
 const f=fixture(),result=await resolveSignInReturn(info,'/register',f.auth,()=>false);
 assert.equal(result.ok,true);assert.equal(result.destination,'/team');assert.deepEqual(f.calls,['initialize','session','user']);
});
test('failed callbacks do not report success using an older valid local session',async()=>{
 const f=fixture({initError:{code:'otp_expired'}}),r=await resolveSignInReturn(info,'/team',f.auth,()=>false);
 assert.equal(r.ok,false);assert.deepEqual(f.calls,['initialize']);assert.match(r.message,/expired/);
});
test('a missing browser verifier blocks success even with an existing session',async()=>{
 const f=fixture(),r=await resolveSignInReturn(info,'/register',f.auth,()=>true);
 assert.equal(r.ok,false);assert.deepEqual(f.calls,['initialize']);assert.match(r.message,/same device/);
});
test('an absent or revoked session never produces a verified result',async()=>{
 for(const options of [{session:null},{user:null,userError:{message:'private diagnostics'}}]){
  const f=fixture(options),r=await resolveSignInReturn(info,'/ai',f.auth,()=>false);assert.equal(r.ok,false);assert.doesNotMatch(r.message,/private diagnostics/);
 }
});
test('URL errors and legacy token links are not silently accepted',async()=>{
 for(const callback of [callbackInfo('?error_code=otp_expired'),callbackInfo('','#access_token=secret'),callbackInfo('?code=test&type=recovery')]){
  const f=fixture(),r=await resolveSignInReturn(callback,'/register',f.auth,()=>false);assert.equal(r.ok,false);assert.deepEqual(f.calls,['initialize']);
 }
});

test('a verified work callback resumes only a recent task link for the requesting account',async()=>{
 const {taskReturnIntent,taskReturnPath}=await import('../lib/auth-flow.mjs');
 const org='123e4567-e89b-42d3-a456-426614174000',task='123e4567-e89b-42d3-a456-426614174001';
 const query='?organizationId='+org+'&taskId='+task;
 const intent=taskReturnIntent('/team/evidence',query+'&other=discard','A@example.invalid',100);
 const resume=email=>taskReturnPath(intent,email,200);
 const f=fixture({user:{email:'a@example.invalid'}});
 assert.equal((await resolveSignInReturn(info,'/team/work',f.auth,()=>false,resume)).destination,'/team/evidence'+query);
 assert.equal(resume('someone@example.invalid'),null);
 assert.equal(taskReturnPath(intent,'a@example.invalid',3600101),null);
 assert.equal(taskReturnPath({...intent,path:'//example.invalid'},'a@example.invalid',200),null);
 assert.equal(taskReturnIntent('/team/work','?taskId=missing','a@example.invalid'),null);
});


test('connected workspace sign-in restores only verified bounded internal context',async()=>{
 const {workspaceReturnIntent,workspaceReturnPath}=await import('../lib/auth-flow.mjs');
 const org='123e4567-e89b-42d3-a456-426614174000';
 const intent=workspaceReturnIntent('/team/intelligence','?organizationId='+org+'&sourceId=uk-data-protection&next=https://evil.invalid&access_token=secret','A@example.invalid',100);
 assert.equal(workspaceReturnPath(intent,'a@example.invalid',200),'/team/intelligence?organizationId='+org+'&sourceId=uk-data-protection');
 assert.equal(workspaceReturnPath(intent,'other@example.invalid',200),null);
 assert.equal(workspaceReturnPath(intent,'a@example.invalid',3600101),null);
 assert.equal(workspaceReturnPath({...intent,path:'//evil.invalid'},'a@example.invalid',200),null);
 assert.equal(workspaceReturnIntent('/team/setup','?organizationId=invalid','a@example.invalid'),null);
 assert.equal(workspaceReturnIntent('/team/setup','?organizationId='+org+'&taskId=invalid','a@example.invalid'),null);
 assert.equal(workspaceReturnIntent('/workbench','?organizationId='+org,'a@example.invalid'),null);
 const f=fixture(),resumed=await resolveSignInReturn(info,'/team/briefing',f.auth,()=>false,()=>'/team/briefing?organizationId='+org);
 assert.equal(resumed.destination,'/team/briefing?organizationId='+org);
 for(const path of ['/team/intelligence','/team/coverage','/team/sources','/team/briefing','/team/evidence','/team/assurance','/team/work/reviews'])assert.equal(signInDestination(path),path);
});

test('invitation and assessment handoffs survive verified sign-in without accepting arbitrary returns',async()=>{
 const {workspaceReturnIntent,workspaceReturnPath}=await import('../lib/auth-flow.mjs');
 const {teamHandoff,teamInvitationHref}=await import('../lib/team-handoff.mjs');
 const org='123e4567-e89b-42d3-a456-426614174000',task='123e4567-e89b-42d3-a456-426614174001',record='123e4567-e89b-42d3-a456-426614174002';
 const invitation=teamInvitationHref(org,record,task);
 assert.equal(invitation,'/team/settings?'+new URLSearchParams({organizationId:org,invitationId:record,taskId:task}));
 const intent=workspaceReturnIntent('/team/settings',invitation.split('?')[1]+'&next=https://evil.invalid&access_token=secret','A@example.invalid',100);
 assert.equal(workspaceReturnPath(intent,'a@example.invalid',200),invitation);
 assert.equal(workspaceReturnPath(intent,'other@example.invalid',200),null);
 assert.equal(workspaceReturnPath(intent,'a@example.invalid',3600101),null);
 assert.deepEqual(teamHandoff(invitation.split('?')[1]),{organizationId:org,invitationId:record,taskId:task,error:''});
 for(const query of ['?invitationId='+record,'?organizationId='+org+'&invitationId=invalid','?organizationId='+org+'&organizationId='+task,'?organizationId='+org+'&taskId=invalid'])assert.ok(teamHandoff(query).error);
 assert.equal(teamInvitationHref(org,'https://evil.invalid',task),null);
 assert.equal(workspaceReturnIntent('/team/settings','?organizationId='+org+'&invitationId=invalid','a@example.invalid'),null);
 assert.equal(workspaceReturnIntent('/team/settings','?organizationId='+org+'&invitationId='+record+'&invitationId='+task,'a@example.invalid'),null);
 const assessment=workspaceReturnIntent('/team/assurance','?'+new URLSearchParams({organizationId:org,taskId:task,assessmentId:record,next:'https://evil.invalid'}),'a@example.invalid',100);
 assert.equal(workspaceReturnPath(assessment,'a@example.invalid',200),'/team/assurance?'+new URLSearchParams({organizationId:org,taskId:task,assessmentId:record}));
 assert.equal(workspaceReturnIntent('/team/assurance','?organizationId='+org+'&assessmentId='+record,'a@example.invalid'),null);
 assert.equal(workspaceReturnIntent('/team/assurance','?organizationId='+org+'&taskId='+task+'&assessmentId=invalid','a@example.invalid'),null);
 const otherPage=workspaceReturnIntent('/team/operations','?'+new URLSearchParams({organizationId:org,invitationId:record,assessmentId:record}),'a@example.invalid',100);
 assert.deepEqual(otherPage.values,{organizationId:org});
});

test('verified sign-in preserves exact evidence library and reuse links only in their intended workspace',async()=>{
 const {workspaceReturnIntent,workspaceReturnPath}=await import('../lib/auth-flow.mjs');
 const org='123e4567-e89b-42d3-a456-426614174000',task='123e4567-e89b-42d3-a456-426614174001',file='123e4567-e89b-42d3-a456-426614174002';
 for(const [path,values] of [['/team/evidence',{organizationId:org,evidenceId:file}],['/team/assurance',{organizationId:org,taskId:task,evidenceId:file}]]){
  const query=new URLSearchParams(values).toString(),intent=workspaceReturnIntent(path,query+'&next=https://evil.invalid','A@example.invalid',100);
  assert.equal(workspaceReturnPath(intent,'a@example.invalid',200),path+'?'+query);
  assert.equal(workspaceReturnPath(intent,'other@example.invalid',200),null);
  assert.equal(workspaceReturnPath(intent,'a@example.invalid',3600101),null);
  assert.equal(workspaceReturnIntent(path,query+'&evidenceId='+task,'a@example.invalid'),null);
 }
 for(const query of ['organizationId='+org+'&evidenceId='+file,'organizationId='+org+'&taskId='+task+'&evidenceId=invalid','organizationId='+org+'&taskId='+task+'&evidenceId='+file+'&assessmentId='+file])assert.equal(workspaceReturnIntent('/team/assurance',query,'a@example.invalid'),null);
 assert.equal(workspaceReturnIntent('/team/evidence','organizationId='+org+'&evidenceId=','a@example.invalid'),null);
 assert.deepEqual(workspaceReturnIntent('/team/operations','organizationId='+org+'&evidenceId='+file,'a@example.invalid').values,{organizationId:org});
});

test('starter programme and risk links retain only their exact bounded record through sign-in',async()=>{
 const {workspaceReturnIntent,workspaceReturnPath}=await import('../lib/auth-flow.mjs');
 const org='123e4567-e89b-42d3-a456-426614174000',id='123e4567-e89b-42d3-a456-426614174001';
 for(const [path,key] of [['/team/programmes','programmeId'],['/team/risks','riskId']]){
  assert.equal(signInDestination(path),path);
  const query=new URLSearchParams({organizationId:org,[key]:id}).toString();
  const intent=workspaceReturnIntent(path,query+'&next=https://evil.invalid','A@example.invalid',100);
  assert.equal(workspaceReturnPath(intent,'a@example.invalid',200),path+'?'+query);
  assert.equal(workspaceReturnPath(intent,'other@example.invalid',200),null);
  assert.equal(workspaceReturnPath(intent,'a@example.invalid',3600101),null);
  for(const suffix of ['', 'invalid', 'https://evil.invalid'])assert.equal(workspaceReturnIntent(path,'organizationId='+org+'&'+key+'='+suffix,'a@example.invalid'),null);
  assert.equal(workspaceReturnIntent(path,query+'&'+key+'='+id,'a@example.invalid'),null);
  assert.deepEqual(workspaceReturnIntent('/team/operations',query,'a@example.invalid').values,{organizationId:org});
 }
});
