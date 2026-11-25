import {createHash,randomUUID} from 'node:crypto';
import {importPKCS8,SignJWT} from 'jose';
import {readBoundedJson} from './bounded-http';
import {CollectionError} from './collection-error';
import {atStep} from './collection-step';

const origin='https://api.pipedream.com';
export const accountLinkScopes='connect:accounts:read connect:accounts:write connect:apps:*';
type Scope='connect:projects:read'|'connect:accounts:read'|'connect:actions:*'|'connect:tokens:create';

export function pdConfig(){
 const project=process.env.REGPILOT_PIPEDREAM_PROJECT_ID??'';
 const client=process.env.REGPILOT_PIPEDREAM_CLIENT_ID??'';
 const environment=process.env.REGPILOT_PIPEDREAM_ENVIRONMENT??'development';
 const privateKey=process.env.REGPILOT_PIPEDREAM_PRIVATE_KEY?.replace(/\\n/g,'\n');
 const secret=process.env.REGPILOT_PIPEDREAM_CLIENT_SECRET;
 if(!/^proj_[A-Za-z0-9]+$/.test(project)||!client||(!privateKey&&!secret)||
    (environment!=='development'&&environment!=='production'))return null;
 return {project,client,environment,privateKey,secret};
}
type Config=NonNullable<ReturnType<typeof pdConfig>>;
type Access={token:string;until:number};
const access=new Map<Scope,{key:string;promise:Promise<Access>}>();

// Only these fixed error codes may leave the adapter. Upstream messages can contain customer values.
export function pdFailure(value:unknown,fallback:string){
 if(!value)return fallback;
 const message=JSON.stringify(value).slice(0,8192).toLowerCase();
 if(/billing|plan (?:does not|doesn't|upgrade)|upgrade (?:your|the) plan|subscription required/.test(message))return 'PLAN_REQUIRED';
 if(/insufficient.scope|missing (?:permission|scope)|requires? the.+scope/.test(message))return 'INSUFFICIENT_SCOPE';
 if(/revoked|bad credentials|invalid.grant/.test(message))return 'CREDENTIAL_REJECTED';
 if(/version.{0,80}(?:not found|not published)|component.{0,50}not found/.test(message))return 'ACTION_UNAVAILABLE';
 return fallback;
}

async function jsonResponse(res:Response,limit:number){
 if(!res.ok){
  const fallback=res.status===402?'PLAN_REQUIRED':res.status===429?'RATE_LIMITED':res.status===403||res.status===401?'ACCESS_DENIED':res.status===404?'TARGET_MISMATCH':res.status===400||res.status===422?'INVALID_REQUEST':'PROVIDER_UNAVAILABLE';
  const detail=await readBoundedJson(res,8192).catch(()=>null);
  const code=pdFailure(detail,fallback);
  const retry=Number(res.headers.get('Retry-After'));
  throw new CollectionError(code,Number.isFinite(retry)&&retry>0?Math.min(3600,retry):undefined);
 }
 return readBoundedJson(res,limit);
}

async function tokenBody(c:Config,scope:Scope){
 const base={grant_type:'client_credentials',client_id:c.client,scope};
 if(!c.privateKey)return {...base,client_secret:c.secret};
 try{
  const pem=await importPKCS8(c.privateKey,'ES256');
  const now=Math.floor(Date.now()/1000);
  const assertion=await new SignJWT({}).setProtectedHeader({alg:'ES256',typ:'client-authentication+jwt'})
   .setIssuer(c.client).setSubject(c.client).setAudience(origin).setIssuedAt(now)
   .setExpirationTime(now+60).setJti(randomUUID()).sign(pem);
  return {...base,client_assertion_type:'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',client_assertion:assertion};
 }catch{throw new CollectionError('INVALID_CONFIGURATION');}
}

async function bearer(c:Config,scope:Scope,fetcher:typeof fetch){
 const key=createHash('sha256').update(JSON.stringify([c.project,c.client,c.environment,c.privateKey||c.secret])).digest('hex');
 const cached=access.get(scope);
 if(cached?.key===key){
  const value=await cached.promise;
  if(value.until>Date.now()+30000)return value.token;
 }
 const promise=(async()=>{
  const response=await fetcher(origin+'/v1/oauth/token',{method:'POST',redirect:'error',cache:'no-store',
   signal:AbortSignal.timeout(8000),headers:{'Content-Type':'application/json'},body:JSON.stringify(await tokenBody(c,scope))});
  const v=await jsonResponse(response,16384);
  if(typeof v.access_token!=='string'||!v.access_token||v.access_token.length>8192||/\s/.test(v.access_token)||
     !Number.isFinite(v.expires_in)||v.expires_in<=0)throw new CollectionError('INVALID_RESPONSE');
  return {token:v.access_token as string,until:Date.now()+Math.min(3600,v.expires_in)*1000};
 })();
 access.set(scope,{key,promise});
 try{return (await promise).token;}catch(error){if(access.get(scope)?.promise===promise)access.delete(scope);throw error;}
}

async function request(config:Config,scope:Scope,path:string,fetcher:typeof fetch,payload?:object){
 const token=await bearer(config,scope,fetcher);
 const res=await fetcher(origin+'/v1/connect/'+path,{method:payload?'POST':'GET',redirect:'error',cache:'no-store',
  signal:AbortSignal.timeout(20000),
  headers:{Authorization:'Bearer '+token,'x-pd-environment':config.environment,'Content-Type':'application/json'},
  ...(payload?{body:JSON.stringify(payload)}:{})});
 if(res.status===401)access.delete(scope);
 return jsonResponse(res,1_000_000);
}

export function pdRequest(scope:Scope,path:string,fetcher:typeof fetch,payload?:object){
 const config=pdConfig();
 if(!config)throw new CollectionError('PROVIDER_DISABLED');
 return request(config,scope,config.project+path,fetcher,payload);
}

/** Project aggregate for private operations. Never returns account records or credentials. */
export async function pdProjectHealth(fetcher:typeof fetch=fetch){
 const c=pdConfig();
 if(!c)throw new CollectionError('PROVIDER_DISABLED');
 const project=await atStep('grant',()=>request(c,'connect:projects:read','projects/'+c.project,fetcher));
 if(project?.id!==c.project)throw new CollectionError('TARGET_MISMATCH',undefined,'grant');
 const accounts=await atStep('records',()=>request(c,'connect:accounts:read',c.project+'/accounts?limit=1&include_credentials=false',fetcher));
 const total=accounts?.page_info?.total_count;
 if(!Array.isArray(accounts?.data)||accounts.data.length>1||!Number.isSafeInteger(total)||total<0||
    accounts.data.length!==Math.min(1,total))throw new CollectionError('INVALID_RESPONSE',undefined,'records');
 return {environment:c.environment,checkedAt:new Date().toISOString(),accounts:total};
}
