import {createRemoteJWKSet,jwtVerify,type JWTVerifyGetKey} from 'jose';

const issuer='https://token.actions.githubusercontent.com';
const keys=createRemoteJWKSet(new URL(issuer+'/.well-known/jwks'),{timeoutDuration:5000,cooldownDuration:30000,cacheMaxAge:600000});
export const WORKER_AUDIENCE='regpilot-private-worker-staging';
const repository='alanscott1uk-dev/regpilot-ai.',repositoryId='1434996130',ownerId='348533998';
const workflow=repository+'/.github/workflows/private-worker.yml@refs/heads/main';
export class WorkerIdentityError extends Error {constructor(){super('Worker identity rejected');}}
/** No long-lived scheduler credential. Only this repository's exact main-branch
 * workflow on GitHub-hosted runners can invoke this staging worker. */
export async function verifyWorkerIdentity(header:string|null,getKey:JWTVerifyGetKey=keys){
 try{
  if(!header||header.length>16000||!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(header))throw new Error();
  const {payload:p}=await jwtVerify(header.slice(7),getKey,{issuer,audience:WORKER_AUDIENCE,algorithms:['RS256'],clockTolerance:5,maxTokenAge:'10m',requiredClaims:['exp','iat','nbf','jti','sub']});
  const legacy='repo:'+repository+':ref:refs/heads/main';
  const immutable='repo:alanscott1uk-dev@'+ownerId+'/regpilot-ai.@'+repositoryId+':ref:refs/heads/main';
  if(p.repository!==repository||p.repository_id!==repositoryId||p.repository_owner_id!==ownerId||p.ref!=='refs/heads/main'||p.workflow_ref!==workflow||p.runner_environment!=='github-hosted'||!['schedule','push','workflow_dispatch'].includes(String(p.event_name))||![legacy,immutable].includes(String(p.sub)))throw new Error();
  if(typeof p.run_id!=='string'||!/^\d{1,20}$/.test(p.run_id)||typeof p.run_attempt!=='string'||!/^\d{1,5}$/.test(p.run_attempt)||typeof p.jti!=='string'||p.jti.length>128||!p.jti.length||!p.exp||!p.iat||p.exp-p.iat>600)throw new Error();
  return {invocationKey:'github:'+p.run_id+':'+p.run_attempt,runId:p.run_id};
 }catch{throw new WorkerIdentityError();}
}
