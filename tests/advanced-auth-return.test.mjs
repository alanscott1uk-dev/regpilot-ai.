import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {workspaceReturnIntent,workspaceReturnPath,signInDestination} from '../lib/auth-flow.mjs';
test('public programme choices return to the same signed-in user and workspace',()=>{
 const email='operator@example.invalid',path='/team/programmes',starter='soc2-iso27001-joint',org=randomUUID();
 for(const selected of [{starter},{starter,organizationId:org}]){
  const query=new URLSearchParams(selected),intent=workspaceReturnIntent(path,query.toString(),email,1000);
  assert.deepEqual(intent.values,selected);assert.equal(workspaceReturnPath(intent,email,2000),path+'?'+query);
  assert.equal(workspaceReturnPath(intent,'other@example.invalid',2000),null);
 }
 for(const query of ['starter=../team','starter=a&starter=b','starter=a&programmeId='+org,'starter=a&organizationId=unknown'])assert.equal(workspaceReturnIntent(path,query,email),null);
});
test('fresh-signature, integration and evaluation returns retain only validated company-bound identifiers',()=>{const organizationId=randomUUID(),email='fixture@example.invalid';for(const [path,keys] of [['/team/developers',['monitor']],['/team/effectivity',['policyId','releaseId','challengeId']],['/team/integrations',['endpointId','deliveryId']],['/team/evaluations',['caseId','runId']]]){const values={organizationId,...Object.fromEntries(keys.map(key=>[key,randomUUID()]))},search=new URLSearchParams({...values,next:'https://external.invalid',access_token:'must-not-persist'}),intent=workspaceReturnIntent(path,search.toString(),email,1000);assert.equal(signInDestination(path),path);assert.deepEqual(intent.values,values);assert.equal(workspaceReturnPath(intent,email,2000),path+'?'+new URLSearchParams(values));assert.equal(workspaceReturnPath(intent,'someone-else@example.invalid',2000),null);for(const key of keys){const invalid=new URLSearchParams(values);invalid.set(key,'../../unexpected');assert.equal(workspaceReturnIntent(path,invalid.toString(),email),null);const duplicate=new URLSearchParams(values);duplicate.append(key,randomUUID());assert.equal(workspaceReturnIntent(path,duplicate.toString(),email),null);}}});
