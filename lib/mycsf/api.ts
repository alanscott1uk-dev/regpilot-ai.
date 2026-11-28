import {createHash} from 'node:crypto';
import {z} from 'zod';
import {readBoundedJson} from '../connectors/bounded-http';
import {IntelligenceError} from '../server/intelligence-service';
import {MAX_EVIDENCE_BYTES} from '../evidence/file-guard.mjs';
import type {HitrustTier} from '../audit-catalogue/hitrust';

const origin='https://api.mycsf.net';
export const apiCredentials=z.object({username:z.string().trim().min(1).max(150).regex(/^[\x21-\x39\x3b-\x7e]+$/),key:z.string().min(1).max(512).regex(/^[\x21-\x7e]+$/)}).strict();
export const remoteId=z.number().int().positive().max(2147483647);
export const uid=z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/);
export type ApiCredentials=z.infer<typeof apiCredentials>;
export const maturityLevels=['POLICY','PROCEDURE','IMPLEMENTED','MEASURED','MANAGED'] as const;
export type MaturityLevel=typeof maturityLevels[number];
export type Statement={buid:string;reference:string;domain:string;text:string;applicability:string;hash:string};
export type Snapshot={name:string;tier:HitrustTier;rows:Statement[];hash:string};
export const digest=(s:string|Uint8Array)=>createHash('sha256').update(s).digest('hex');
// The public OpenAPI document specifies the upload endpoint and receipt, but omits multipart field names.
export function uploadParts(){
 const parts=(process.env.REGPILOT_MYCSF_UPLOAD_PARTS??'').split(',');
 if(parts.length!==2||parts[0]===parts[1]||parts.some(p=>!/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(p)))return null;
 return {model:parts[0],file:parts[1]};
}
const bad=()=>new IntelligenceError('MyCSF returned incomplete or unrecognised assessment data. The previous scope has been kept.',502);
function obj(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))throw bad();return v as Record<string,unknown>;}
function str(v:unknown,max=16000){if(typeof v!=='string'||v.length>max)throw bad();return v.trim();}
function integer(v:unknown){const n=remoteId.safeParse(typeof v==='string'&&/^\d+$/.test(v)?Number(v):v);if(!n.success)throw bad();return n.data;}
function opt(v:unknown,max:number){return v==null?'':str(v,max);}
function tierOf(v:unknown):HitrustTier|undefined{
 if(typeof v!=='string')return;
 const explicit=v.toLowerCase().match(/\b(e1|i1|r2)\b/g);
 if(explicit){if(new Set(explicit).size!==1)throw bad();return explicit[0] as HitrustTier;}
 if(/\bessentials?\b/i.test(v))return 'e1';if(/\brisk[- ]based\b/i.test(v))return 'r2';if(/\bimplemented\b/i.test(v))return 'i1';
}
export function myCsfApi(credential:ApiCredentials,fetcher:typeof fetch=fetch){
 const c=apiCredentials.parse(credential);
 async function request(path:string,method='GET',body?:BodyInit,contentType?:string){
  if(!path.startsWith('/v1/')||path.includes('..')||path.startsWith('//'))throw bad();
  let response:Response;
  try{response=await fetcher(origin+path,{method,headers:{'X-API-KEY':c.username+':'+c.key,Accept:'application/json',...(contentType?{'Content-Type':contentType}:{})},body,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(9000)});}catch{throw new IntelligenceError('MyCSF did not confirm the request. Reconcile the assessment before retrying an export.',502);}
  if(response.url&&new URL(response.url).origin!==origin){await response.body?.cancel();throw bad();}
  if(response.ok)return response;
  await response.body?.cancel();
  if(response.status===401||response.status===403)throw new IntelligenceError('MyCSF rejected access. Check the API user, its permissions and the subscription.',403);
  throw new IntelligenceError('MyCSF could not complete the request (HTTP '+response.status+').',response.status===429?429:502);
 }
 async function json(path:string){const response=await request(path);try{return await readBoundedJson(response,10_000_000);}catch{throw bad();}}
 async function list(path:string,keys:string[]){
  let page=path,expectedTotal:number|undefined;const seen=new Set<string>(),rows:Record<string,unknown>[]=[];
  while(page){
   if(seen.has(page)||seen.size>=30)throw bad();seen.add(page);const data=await json(page);
   const d=Array.isArray(data)?null:obj(data);
   const a=d?keys.map(k=>d[k]).find(Array.isArray):data;
   if(!Array.isArray(a)||rows.length+a.length>6000)throw bad();
   const total=d?.total??d?.Total;
   if(total!==undefined){
    const count=typeof total==='string'&&/^\d+$/.test(total)?Number(total):total;
    if(typeof count!=='number'||!Number.isSafeInteger(count)||count<0||count>6000||(expectedTotal!==undefined&&count!==expectedTotal))throw bad();
    expectedTotal=count;
   }
   rows.push(...a.map(obj));
   if(expectedTotal!==undefined&&rows.length>expectedTotal)throw bad();
   if(!d)break;
   const next=d.next??d.Next??d.nextLink??d.NextLink??(d._links as Record<string,unknown>|undefined)?.next;
   if(!next){if(d.hasMore===true||d.HasMore===true)throw bad();break;}
   const target=new URL(str(typeof next==='object'?obj(next).href:next,2000),origin+path);
   if(target.origin!==origin||target.pathname!==path||target.username||target.password||target.hash)throw bad();page=target.pathname+target.search;
  }
  if(expectedTotal!==undefined&&rows.length!==expectedTotal)throw bad();
  return rows;
 }
 async function assessments(subscriber:number){
  const rows=await list('/v1/subscribers/'+remoteId.parse(subscriber)+'/assessments',['Assessments','assessments','Items','items','Data','data','Results']);
  return rows.map(r=>({id:integer(r.Id??r.AssessmentId??r.id),name:str(r.Name??r.AssessmentName??r.name,200),type:opt(r.AssessmentTypeName??r.AssessmentType??r.TypeName??r.Type,150)}));
 }
 async function snapshot(subscriber:number,assessment:number,tier:HitrustTier):Promise<Snapshot>{
  const offered=(await assessments(subscriber)).find(x=>x.id===assessment);if(!offered)throw new IntelligenceError('Assessment is outside this MyCSF subscriber.',409);
  const detail=await list('/v1/assessmentdetailed/'+remoteId.parse(assessment),['Requirements','requirements','items','Items','Data','data']);
  if(!detail.length)throw bad();const tiers=new Set<HitrustTier>(),ids=new Set<string>();const offeredTier=tierOf(offered.type);if(offeredTier)tiers.add(offeredTier);
  const rows=detail.map(r=>{
   if(integer(r['OBJ ID'])!==assessment)throw bad();const kind=tierOf(r.TYPE);if(kind)tiers.add(kind);
   const buid=uid.safeParse(r.BUID);if(!buid.success||ids.has(buid.data))throw bad();ids.add(buid.data);
   const text=str(r.STATEMENT),reference=opt(r['CONTROL REFERENCE'],250),domain=opt(r.DOMAIN,300),applicability=opt(r.APPLICABILITY,300);
   const baseline=r['BASELINE CONTROL'];if(!text||(baseline!=null&&typeof baseline!=='boolean'))throw bad();
   const row={buid:buid.data,reference,domain,text,applicability};
   const boundary={scope:opt(r.SCOPE,16000),level:opt(r.LEVEL,300),baseline:baseline??null};
   return {...row,hash:digest(JSON.stringify([row,boundary]))};
  }).sort((a,b)=>a.buid<b.buid?-1:a.buid>b.buid?1:0);
  if(tiers.size!==1||!tiers.has(tier))throw new IntelligenceError('MyCSF did not confirm the selected assessment type.',409);
  return {name:offered.name,tier,rows,hash:digest(JSON.stringify([subscriber,assessment,tier,rows.map(r=>r.hash)]))};
 }
 async function documents(assessment:number,documentType:number){
  return (await list('/v1/assessment/'+remoteId.parse(assessment)+'/documents/'+remoteId.parse(documentType),['Documents','documents','Items','items','Data','data'])).map(r=>({id:integer(r.Id??r.DocumentId),assessment:integer(r.CSFAssessmentId??r.AssessmentId),type:integer(r.DocumentTypeId),filename:opt(r.AttachmentFilename,500),name:opt(r.Name,500),attachment:opt(r.AttachmentId,200)}));
 }
 async function upload(assessment:number,filename:string,bytes:Uint8Array,contentType:string,documentType:string){
  const parts=uploadParts();if(!parts)throw new IntelligenceError('The MyCSF upload format awaits vendor confirmation. Choose an existing MyCSF document to verify and link.',409);
  const form=new FormData();form.append(parts.model,JSON.stringify({AssessmentId:assessment,DocumentName:filename,DocumentType:documentType,DocumentOverwrite:false,ThirdParty:false,RequirementStatements:[]}));
  form.append(parts.file,new Blob([new Uint8Array(bytes)],{type:contentType}),filename);
  const r=await request('/v1/assessment/'+remoteId.parse(assessment)+'/document','POST',form);
  try{const ack=obj(await readBoundedJson(r));if(integer(ack.AssessmentId)!==assessment)throw bad();return integer(ack.DocumentId);}catch{throw new IntelligenceError('MyCSF did not return a verifiable upload receipt. Reconcile the document before another upload.',502);}
 }
 async function verifyDocument(id:number,attachment:string,expectedHash:string){
  if(!attachment||!uid.safeParse(attachment).success)throw bad();
  const r=await request('/v1/documents/'+remoteId.parse(id)+'/download/'+encodeURIComponent(attachment));const reader=r.body?.getReader();if(!reader)throw bad();
  const hash=createHash('sha256');let size=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>MAX_EVIDENCE_BYTES)throw bad();hash.update(value);}}finally{await reader.cancel().catch(()=>{});}
  if(size===0||hash.digest('hex')!==expectedHash)throw new IntelligenceError('The MyCSF document bytes differ from the approved evidence.',409);
 }
 async function link(assessment:number,buid:string,document:number,levels:readonly MaturityLevel[]){
  const path='/v1/assessment/'+remoteId.parse(assessment)+'/requirement/'+encodeURIComponent(uid.parse(buid))+'/document/'+remoteId.parse(document);
  const r=await request(path,'PUT',JSON.stringify({Actor:'SUBSCRIBER',MaturityLevels:levels}),'application/json');await r.body?.cancel();
 }
 return {assessments,snapshot,documents,upload,verifyDocument,link};
}
