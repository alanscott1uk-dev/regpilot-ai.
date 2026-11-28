import {createHash,createHmac,timingSafeEqual,randomBytes,randomUUID} from 'node:crypto';
import {Prisma,type CustomerApiCredential} from '@prisma/client';
import {z} from 'zod';
import {db} from './db';
import {workspaceConfigured} from './ai-auth';
import {transaction,IntelligenceError} from './intelligence-service';
import {requireMember,ADMIN} from './workspace-member';
import {CUSTOMER_API_LIMITS,CUSTOMER_API_SCOPES,type CustomerApiScope} from '../customer-api';
import {hashValue} from '../regulatory/intelligence';

export class CustomerApiError extends IntelligenceError {constructor(message:string,status:number,public code:string,public retryAfter?:number){super(message,status);this.name='CustomerApiError';}}
export type CustomerApiSession={credentialId:string;organizationId:string;issuedById:string;version:number;tokenHash:string;rate:{limit:number;remaining:number;reset:number}};
export type CustomerApiPrincipal={credential:CustomerApiCredential;controlIds:string[]};
type Tx=Prisma.TransactionClient;
export const customerApiConfigured=()=>workspaceConfigured()&&process.env.REGPILOT_CUSTOMER_API_ENABLED==='true';
export function secretHash(token:string){return createHash('sha256').update(token).digest('hex');}
export function newCustomerApiSecret(id:string=randomUUID()){const token='rpk_'+id+'_'+randomBytes(32).toString('base64url');return {id,token,secretHash:secretHash(token),hint:token.slice(-8)};}
const equal=(a:string,b:string)=>a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
function unavailable(){return new CustomerApiError('API credential is unavailable',401,'invalid_credential');}
function assertEnabled(){if(!customerApiConfigured())throw new CustomerApiError('The customer API is not activated in this environment',503,'api_inactive');}
export async function currentCustomerApiPrincipal(tx:Tx,session:CustomerApiSession,scope?:CustomerApiScope):Promise<CustomerApiPrincipal>{
 assertEnabled();const credential=await tx.customerApiCredential.findFirst({where:{id:session.credentialId,organizationId:session.organizationId}});
 if(!credential||credential.version!==session.version||!equal(credential.secretHash,session.tokenHash)||credential.revokedAt||credential.expiresAt<=new Date()||credential.issuedById!==session.issuedById)throw unavailable();
 try{await requireMember(tx,{organizationId:credential.organizationId,userId:credential.issuedById,role:'ADMIN'},ADMIN);}catch(error){if(error instanceof IntelligenceError)throw unavailable();throw error;}
 if(!credential.scopes.length||credential.scopes.some(value=>!CUSTOMER_API_SCOPES.includes(value as CustomerApiScope)))throw unavailable();
 if(scope&&!credential.scopes.includes(scope))throw new CustomerApiError('This credential does not grant the required scope',403,'insufficient_scope');
 const grants=await tx.customerApiControlGrant.findMany({where:{organizationId:session.organizationId,credentialId:session.credentialId},select:{controlId:true},orderBy:{controlId:'asc'},take:CUSTOMER_API_LIMITS.controls+1});
 if(grants.length>CUSTOMER_API_LIMITS.controls)throw unavailable();return {credential,controlIds:grants.map(grant=>grant.controlId)};
}
/** Admission reserves one persisted per-client and company rate unit. Business operations
 * revalidate the exact key/version and issuer authority in their own short transaction. */
export async function authenticateCustomerApi(request:Request,scope:CustomerApiScope|readonly CustomerApiScope[]):Promise<CustomerApiSession&{grantedScopes:string[]}>{
 assertEnabled();const header=request.headers.get('authorization')||'',match=/^Bearer (rpk_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_[A-Za-z0-9_-]{43})$/.exec(header);if(!match)throw unavailable();
 const credential=await db.customerApiCredential.findUnique({where:{id:match[2]},select:{id:true,organizationId:true,issuedById:true,secretHash:true,version:true}}),hashed=secretHash(match[1]);if(!credential||!equal(credential.secretHash,hashed))throw unavailable();
 const session:CustomerApiSession={credentialId:credential.id,organizationId:credential.organizationId,issuedById:credential.issuedById,version:credential.version,tokenHash:hashed,rate:{limit:0,remaining:0,reset:0}},now=Date.now(),minute=new Date(Math.floor(now/60000)*60000),reset=minute.getTime()/1000+60;
 const admitted=await transaction({organizationId:session.organizationId,userId:session.issuedById,role:'ADMIN'},async tx=>{
  const principal=await currentCustomerApiPrincipal(tx,session),counts:number[]=[];
  for(const [bucket,limit] of [['key:'+session.credentialId,CUSTOMER_API_LIMITS.requestsPerKeyMinute],['company',CUSTOMER_API_LIMITS.requestsPerCompanyMinute]] as const){
   const row=await tx.customerApiBudget.upsert({where:{organizationId_bucket_minute:{organizationId:session.organizationId,bucket,minute}},create:{organizationId:session.organizationId,bucket,minute,count:1},update:{count:{increment:1}}});
   if(row.count>limit)throw new CustomerApiError('API rate allowance reached; wait until the next minute',429,'rate_limited',Math.max(1,Math.ceil(reset-Date.now()/1000)));counts.push(limit-row.count);
  }
  await tx.customerApiCredential.update({where:{id:session.credentialId},data:{lastUsedAt:new Date()}});
  await tx.customerApiBudget.deleteMany({where:{organizationId:session.organizationId,minute:{lt:new Date(minute.getTime()-86400000)}}});
  return {allowed:(typeof scope==='string'?[scope]:scope).some(value=>principal.credential.scopes.includes(value)),grantedScopes:principal.credential.scopes,rate:{limit:CUSTOMER_API_LIMITS.requestsPerKeyMinute,remaining:Math.min(...counts),reset}};
 });
 if(!admitted.allowed)throw new CustomerApiError('This credential does not grant the required scope',403,'insufficient_scope');return {...session,rate:admitted.rate,grantedScopes:admitted.grantedScopes};
}
export function customerApiTransaction<T>(session:CustomerApiSession,scope:CustomerApiScope,fn:(tx:Tx,principal:CustomerApiPrincipal)=>Promise<T>){return transaction({organizationId:session.organizationId,userId:session.issuedById,role:'ADMIN'},async tx=>fn(tx,await currentCustomerApiPrincipal(tx,session,scope)));}

const cursorSchema=z.object({v:z.literal(1),credentialId:z.uuid(),organizationId:z.uuid(),version:z.number().int().positive(),resource:z.string().max(40),filterHash:z.string().regex(/^[a-f0-9]{64}$/),asOf:z.iso.datetime(),at:z.iso.datetime(),id:z.uuid()}).strict();
export type CustomerApiCursor=z.infer<typeof cursorSchema>;
export function encodeCustomerApiCursor(session:CustomerApiSession,cursor:CustomerApiCursor){const value=Buffer.from(JSON.stringify(cursor)).toString('base64url');return value+'.'+createHmac('sha256',session.tokenHash).update(value).digest('base64url');}
export function customerApiPage(session:CustomerApiSession,url:string,resource:string,allowedExtra:string[]=[]){
 const params=new URL(url).searchParams;for(const key of params.keys())if(!['limit','cursor',...allowedExtra].includes(key)||params.getAll(key).length!==1)throw new CustomerApiError('Unknown or repeated query parameter',400,'invalid_query');
 const limit=params.has('limit')?Number(params.get('limit')):CUSTOMER_API_LIMITS.defaultPage;if(!Number.isInteger(limit)||limit<1||limit>CUSTOMER_API_LIMITS.page)throw new CustomerApiError('Choose a page limit between 1 and 100',400,'invalid_query');
 const filter=Object.fromEntries(allowedExtra.filter(key=>params.has(key)).map(key=>[key,params.get(key)])),filterHash=hashValue(filter);let cursor:CustomerApiCursor|null=null;
 if(params.has('cursor')){try{const raw=params.get('cursor')!;if(raw.length>1500)throw Error();const [payload,signature,...rest]=raw.split('.');if(!payload||!signature||rest.length||!equal(signature,createHmac('sha256',session.tokenHash).update(payload).digest('base64url')))throw Error();cursor=cursorSchema.parse(JSON.parse(Buffer.from(payload,'base64url').toString('utf8')));if(cursor.credentialId!==session.credentialId||cursor.organizationId!==session.organizationId||cursor.version!==session.version||cursor.resource!==resource||cursor.filterHash!==filterHash||Date.parse(cursor.asOf)>Date.now()+5000||Date.now()-Date.parse(cursor.asOf)>CUSTOMER_API_LIMITS.cursorMinutes*60000||Date.parse(cursor.at)>Date.parse(cursor.asOf))throw Error();}catch{throw new CustomerApiError('Pagination cursor is invalid, expired or belongs to another request',400,'invalid_cursor');}}
 return {limit,filter,filterHash,cursor,asOf:cursor?.asOf||new Date().toISOString()};
}
export function nextCustomerApiCursor(session:CustomerApiSession,page:ReturnType<typeof customerApiPage>,resource:string,last:{id:string;createdAt:Date}){return encodeCustomerApiCursor(session,{v:1,credentialId:session.credentialId,organizationId:session.organizationId,version:session.version,resource,filterHash:page.filterHash,asOf:page.asOf,at:last.createdAt.toISOString(),id:last.id});}
