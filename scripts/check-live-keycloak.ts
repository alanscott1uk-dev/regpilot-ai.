// Run only against a disposable, loopback-bound Keycloak container on the CI runner.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {collectOperationalRecord} from '../lib/connectors/operational-records';
import {observationOutcome,observationSchema,signalChanges} from '../lib/connectors/observation';

const local='http://127.0.0.1:8180',realm='regpilot-staging',client='regpilot-reader',scope='identity.regpilot.test';
const secret=()=>randomBytes(30).toString('hex');
async function main(){
 process.env.REGPILOT_KEYCLOAK_HOST=scope;
 const password=process.env.KC_BOOTSTRAP_ADMIN_PASSWORD;
 if(!password)throw Error('The disposable server credentials are required');
 const login=await fetch(local+'/realms/master/protocol/openid-connect/token',{method:'POST',body:new URLSearchParams({grant_type:'password',client_id:'admin-cli',username:'regpilot-test-admin',password})});
 assert.equal(login.status,200,'Disposable administrator login');
 const adminToken=(await login.json()).access_token;
 async function administer(path:string,method='GET',body?:unknown){
  const response=await fetch(local+'/admin/realms'+path,{method,headers:{Authorization:'Bearer '+adminToken,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  assert.ok(response.ok,method+' '+path+' '+response.status);
  const text=await response.text();return text?JSON.parse(text):null;
 }
 const initialSecret=secret();
 await administer('','POST',{realm,enabled:true,bruteForceProtected:true,verifyEmail:true,registrationAllowed:false,eventsEnabled:true,adminEventsEnabled:true});
 await administer('/'+realm+'/clients','POST',{clientId:client,enabled:true,protocol:'openid-connect',publicClient:false,standardFlowEnabled:false,directAccessGrantsEnabled:false,serviceAccountsEnabled:true,secret:initialSecret});
 const clients='/'+realm+'/clients';
 const [reader]=await administer(clients+'?clientId='+client),[manager]=await administer(clients+'?clientId=realm-management');
 const serviceUser=await administer(clients+'/'+reader.id+'/service-account-user');
 const roles=await Promise.all(['view-realm','view-events'].map(role=>administer(clients+'/'+manager.id+'/roles/'+role)));
 await administer('/'+realm+'/users/'+serviceUser.id+'/role-mappings/clients/'+manager.id,'POST',roles);
 const transport:typeof fetch=async(input,options)=>{
  const url=new URL(String(input));assert.equal(url.origin,'https://'+scope);
  const response=await fetch(local+url.pathname+url.search,options);
  return new Response(response.body,{status:response.status,headers:response.headers});
 };
 const read=(value:string)=>collectOperationalRecord('KEYCLOAK_REALM',{scope,record:realm,reference:client},value,transport).then(v=>observationSchema.parse(v));
 const baseline=await read(initialSecret);assert.equal(observationOutcome(baseline),'OBSERVED');
 const repeated=await read(initialSecret);assert.equal(signalChanges(repeated,baseline).length,0);
 await administer('/'+realm,'PUT',{realm,verifyEmail:false});
 const drift=await read(initialSecret);assert.ok(signalChanges(drift,repeated).some(s=>s.id==='verify-email'&&s.after==='FAIL'));
 const renewed=await administer(clients+'/'+reader.id+'/client-secret','POST');
 await assert.rejects(read(initialSecret),{code:'CREDENTIAL_REJECTED'});
 await administer('/'+realm,'PUT',{realm,verifyEmail:true});
 const recovered=await read(renewed.value);assert.equal(observationOutcome(recovered),'OBSERVED');
 await writeFile('live-keycloak-evidence.json',JSON.stringify({source:'Disposable RegPilot CI Keycloak realm',retiredCredentialRejected:true,baseline,repeated,drift,recovered},null,2));
 console.log('Keycloak verified six controls, steady repeat, changed policy, rejected retired secret and successful collection after rotation.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
