import {z} from 'zod';
import {booleanCheck,providerReader,readBoundedJson} from './bounded-http';
import {CollectionError} from './github';
import type {Observation} from './observation';

const name=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/);
export const keycloakTarget=z.object({
 scope:z.string().max(100).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/),
 record:name,reference:name
});
export async function collectKeycloak(target:z.infer<typeof keycloakTarget>,secret:string,fetcher:typeof fetch=fetch):Promise<Observation>{
 const {scope,record:realm,reference:clientId}=keycloakTarget.parse(target);
 if(scope!==process.env.REGPILOT_KEYCLOAK_HOST)throw new CollectionError('INVALID_TARGET');
 const host='https://'+scope,issuer=host+'/realms/'+realm;
 const response=await fetcher(issuer+'/protocol/openid-connect/token',{
  method:'POST',body:new URLSearchParams({grant_type:'client_credentials',client_id:clientId,client_secret:secret}),
  redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)
 });
 if(!response.ok){
  await response.body?.cancel();
  throw new CollectionError([400,401].includes(response.status)?'CREDENTIAL_REJECTED':'PROVIDER_UNAVAILABLE');
 }
 const auth=z.object({access_token:z.string().min(1).max(24576),token_type:z.string().toLowerCase().pipe(z.literal('bearer'))}).parse(await readBoundedJson(response,32768));
 const get=providerReader(fetcher,{Authorization:'Bearer '+auth.access_token});
 const endpoint=host+'/admin/realms/'+realm;
 const config=(await get(endpoint))!.body;
 if(config.realm!==realm||typeof config.id!=='string'||!config.id)throw new CollectionError('TARGET_MISMATCH');
 const events=(await get(endpoint+'/events/config'))!.body;
 return {engine:'keycloak-realm-v1',sourceUrl:issuer,capturedAt:new Date().toISOString(),
  checks:[
   booleanCheck('realm-enabled','Realm enabled',config.enabled,true,'Review the monitored realm.'),
   booleanCheck('login-protection','Brute-force protection enabled',config.bruteForceProtected,true,'Review login protections in the realm.'),
   booleanCheck('verify-email','Email verification required',config.verifyEmail,true,'Review the realm login policy.'),
   booleanCheck('registration','Self-registration disabled',config.registrationAllowed,false,'Review how identities can join the realm.'),
   booleanCheck('login-events','Login event storage enabled',events.eventsEnabled,true,'Review login event retention settings.'),
   booleanCheck('admin-events','Admin event storage enabled',events.adminEventsEnabled,true,'Review admin event retention settings.')
  ],limitations:['Realm-level settings at collection time. Individual sign-ins and user MFA enrolment require separate evidence.']};
}
