import {z} from 'zod';
import {validCredential,readBoundedJson} from './bounded-http';
import {CollectionError} from './collection-error';

export const benchlingClient=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{1,99}$/);
const stored=z.object({kind:z.literal('benchling-application'),client:benchlingClient,secret:z.string().refine(validCredential)}).strict();
export function benchlingCredential(client:string,secret:string){return JSON.stringify(stored.parse({kind:'benchling-application',client,secret}));}
export async function benchlingAccess(tenant:string,secret:string,fetcher:typeof fetch){
 if(!secret.startsWith('{'))return secret;
 const {client,secret:password}=stored.parse(JSON.parse(secret));
 if(!/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/.test(tenant))throw new CollectionError('INVALID_TARGET');
 const response=await fetcher('https://'+tenant+'.benchling.com/oauth/token',{
  method:'POST',headers:{Accept:'application/json'},body:new URLSearchParams({grant_type:'client_credentials',client_id:client,client_secret:password}),
  redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)
 });
 if(!response.ok){await response.body?.cancel();throw new CollectionError([400,401,403].includes(response.status)?'CREDENTIAL_REJECTED':'PROVIDER_UNAVAILABLE');}
 const data=z.object({access_token:z.string().min(16).max(16384).regex(/^[!-~]+$/),token_type:z.string().toLowerCase().pipe(z.literal('bearer')),expires_in:z.number().int().positive()}).safeParse(await readBoundedJson(response,24576));
 if(!data.success)throw new CollectionError('INVALID_RESPONSE');
 return data.data.access_token;
}
