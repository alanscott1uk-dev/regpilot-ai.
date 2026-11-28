import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,SignJWT,exportJWK,createLocalJWKSet} from 'jose';
import {verifyWorkerIdentity,WORKER_AUDIENCE,WorkerIdentityError} from '../lib/server/worker-identity';
import {POST} from '../app/api/internal/worker/route';

test('worker tokens bind signature, issuer, audience, immutable repository, main workflow and short lifetime',async()=>{
 const key=await generateKeyPair('RS256'),other=await generateKeyPair('RS256'),jwk=await exportJWK(key.publicKey);
 const resolver=createLocalJWKSet({keys:[{...jwk,kid:'fixture',alg:'RS256',use:'sig'}]});
 const now=Math.floor(Date.now()/1000),repo='alanscott1uk-dev/regpilot-ai.';
 const claims={iss:'https://token.actions.githubusercontent.com',aud:WORKER_AUDIENCE,sub:'repo:'+repo+':ref:refs/heads/main',iat:now,nbf:now-1,exp:now+300,jti:'fixture-id',repository:repo,repository_id:'1434996130',repository_owner_id:'348533998',ref:'refs/heads/main',workflow_ref:repo+'/.github/workflows/private-worker.yml@refs/heads/main',runner_environment:'github-hosted',event_name:'schedule',run_id:'123456',run_attempt:'1'};
 const token=async(p:Record<string,unknown>={},privateKey=key.privateKey)=>'Bearer '+await new SignJWT({...claims,...p}).setProtectedHeader({alg:'RS256',kid:'fixture'}).sign(privateKey);
 assert.deepEqual(await verifyWorkerIdentity(await token(),resolver),{invocationKey:'github:123456:1',runId:'123456'});
 assert.equal((await verifyWorkerIdentity(await token({sub:'repo:alanscott1uk-dev@348533998/regpilot-ai.@1434996130:ref:refs/heads/main'}),resolver)).runId,'123456');
 for(const changes of [{iss:'https://attacker.invalid'},{aud:'another-app'},{repository_id:'999'},{repository_owner_id:'999'},{repository:'fork/regpilot-ai.'},{ref:'refs/heads/feature/test'},{event_name:'pull_request'},{workflow_ref:repo+'/.github/workflows/ci.yml@refs/heads/main'},{runner_environment:'self-hosted'},{sub:'repo:'+repo+':pull_request'},{exp:now-20},{iat:now-1000,exp:now+1},{nbf:now+60},{exp:now+3600},{run_id:'../../other'},{run_attempt:''},{jti:null}]){
  await assert.rejects(()=>token(changes).then(t=>verifyWorkerIdentity(t,resolver)),WorkerIdentityError);
 }
 await assert.rejects(()=>token({},other.privateKey).then(t=>verifyWorkerIdentity(t,resolver)),WorkerIdentityError);
 for(const header of [null,'Bearer invalid','Basic abc','Bearer '+ 'a'.repeat(16001)])await assert.rejects(()=>verifyWorkerIdentity(header,resolver),WorkerIdentityError);
});
test('worker endpoint rejects unauthenticated callers before accessing the database',async()=>{
 const r=await POST(new Request('https://example.invalid/api/internal/worker',{method:'POST'}));
 assert.equal(r.status,401);assert.deepEqual(await r.json(),{error:'Unauthorised worker'});
});
