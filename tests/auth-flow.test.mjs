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
