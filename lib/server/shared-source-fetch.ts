import {Prisma,type PublicSourceFetch} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {db} from './db';
import {hashValue} from '../regulatory/intelligence';
import {REGULATORY_SOURCES,officialSourceUrl,type RegulatorySource} from '../regulatory-sources.mjs';

const TTL_MS=300000,LEASE_MS=45000,WAIT_MS=30000;
const payloadSchema=z.object({id:z.string().min(1).max(120),title:z.string().min(1).max(300),url:z.string().url().max(500),updatedAt:z.string().max(100).nullable(),revisionAt:z.string().max(100).nullable(),text:z.string().min(80).max(60000)});
export type PublicSourcePayload=z.infer<typeof payloadSchema>;
export class SourceFetchDeferred extends Error{
 constructor(public code:'SOURCE_FETCH_BUSY'|'SOURCE_FETCH_UNAVAILABLE'|'SOURCE_FETCH_SUPERSEDED',public retryAt:Date){super('Official source retrieval deferred');}
}
export function publicSourceKey(source:RegulatorySource){
 const curated=REGULATORY_SOURCES.find(s=>s.id===source.id);
 if(source.provider==='OFFICIAL_WEB'){
  if(!curated||curated.url!==source.url||curated.path!==source.path||curated.heading!==source.heading)throw Error('Unrecognised official source');
 }else if(!/^\/[a-z0-9][a-z0-9/-]{0,448}$/.test(source.path)||source.path.includes('//')||source.path.endsWith('/')||source.path.startsWith('/api/'))throw Error('Invalid public publication path');
 if(!source.id||source.id.length>120||!source.title||source.title.length>300)throw Error('Invalid public source identity');
 // Never accepts tenant data, private evidence URLs or caller-supplied fetch targets.
 return hashValue({extractor:'official-publication:v1',id:source.id,path:source.path,url:officialSourceUrl(source),heading:source.heading??null,title:source.title});
}
function payload(value:unknown,source:RegulatorySource){
 const result=payloadSchema.parse(value);
 if(result.id!==source.id||result.url!==officialSourceUrl(source))throw Error('Public source identity mismatch');
 return result;
}
function fresh(row:PublicSourceFetch|null,source:RegulatorySource,now:Date){
 if(!row?.fetchedAt||!row.expiresAt||row.expiresAt<=now||row.fetchedAt>now||row.fetchedAt.getTime()<now.getTime()-TTL_MS||row.failureCode)return null;
 try{const official=payload(row.payload,source);if(hashValue(official)!==row.payloadHash)return null;return {official,fetchedAt:row.fetchedAt,reused:true};}catch{return null;}
}
async function claim(key:string,source:RegulatorySource){
 return db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'public-source:'+key},0))`;
  const row=await tx.publicSourceFetch.upsert({where:{key},create:{key,sourceId:source.id},update:{}}),now=new Date();
  const hit=fresh(row,source,now);if(hit)return {kind:'hit' as const,hit};
  if(row.retryAt&&row.retryAt>now)return {kind:'deferred' as const,retryAt:row.retryAt};
  if(row.leaseUntil&&row.leaseUntil>now)return {kind:'busy' as const,retryAt:row.leaseUntil};
  const token=randomUUID();
  await tx.publicSourceFetch.update({where:{key},data:{leaseToken:token,leaseUntil:new Date(now.getTime()+LEASE_MS)}});
  return {kind:'claimed' as const,token,failures:row.failures};
 },{timeout:5000,maxWait:2000});
}

/** Distributed single-flight retrieval for PUBLIC publications only. Never serves
 * stale data as a successful check, and never holds a database lock over I/O. */
export async function loadSharedPublicSource(source:RegulatorySource,loader:()=>Promise<unknown>){
 const key=publicSourceKey(source),deadline=Date.now()+WAIT_MS;
 let row=await db.publicSourceFetch.findUnique({where:{key}});
 const existing=fresh(row,source,new Date());if(existing)return existing;
 while(true){
  const now=new Date();
  if(row?.retryAt&&row.retryAt>now)throw new SourceFetchDeferred('SOURCE_FETCH_UNAVAILABLE',row.retryAt);
  if(row?.leaseUntil&&row.leaseUntil>now){
   if(Date.now()>=deadline)throw new SourceFetchDeferred('SOURCE_FETCH_BUSY',row.leaseUntil);
   await new Promise(r=>setTimeout(r,150+Math.floor(Math.random()*100)));
   row=await db.publicSourceFetch.findUnique({where:{key}});
   const hit=fresh(row,source,new Date());if(hit)return hit;
   continue;
  }
  const admission=await claim(key,source);
  if(admission.kind==='hit')return admission.hit;
  if(admission.kind==='deferred')throw new SourceFetchDeferred('SOURCE_FETCH_UNAVAILABLE',admission.retryAt);
  if(admission.kind==='busy'){row=await db.publicSourceFetch.findUnique({where:{key}});continue;}
  try{
   const official=payload(await loader(),source),fetchedAt=new Date();
   const written=await db.publicSourceFetch.updateMany({where:{key,leaseToken:admission.token,leaseUntil:{gt:fetchedAt}},data:{payload:official as Prisma.InputJsonValue,payloadHash:hashValue(official),fetchedAt,expiresAt:new Date(fetchedAt.getTime()+TTL_MS),leaseToken:null,leaseUntil:null,retryAt:null,failures:0,failureCode:null}});
   if(!written.count)throw new SourceFetchDeferred('SOURCE_FETCH_SUPERSEDED',new Date(Date.now()+1000));
   return {official,fetchedAt,reused:false};
  }catch(error){
   if(error instanceof SourceFetchDeferred)throw error;
   const retryAt=new Date(Date.now()+Math.min(900000,60000*2**Math.min(4,admission.failures)));
   const failed=await db.publicSourceFetch.updateMany({where:{key,leaseToken:admission.token,leaseUntil:{gt:new Date()}},data:{leaseToken:null,leaseUntil:null,retryAt,failures:Math.min(100,admission.failures+1),failureCode:'SOURCE_FETCH_UNAVAILABLE'}});
   if(!failed.count)throw new SourceFetchDeferred('SOURCE_FETCH_SUPERSEDED',new Date(Date.now()+1000));
   throw new SourceFetchDeferred('SOURCE_FETCH_UNAVAILABLE',retryAt);
  }
 }
}
export async function prunePublicSourceFetches(){
 return db.$executeRaw`WITH old AS (SELECT key FROM "PublicSourceFetch" WHERE "updatedAt"<NOW()-interval '30 days' AND ("leaseUntil" IS NULL OR "leaseUntil"<=NOW()) ORDER BY "updatedAt" LIMIT 250 FOR UPDATE SKIP LOCKED) DELETE FROM "PublicSourceFetch" f USING old WHERE f.key=old.key`;
}
