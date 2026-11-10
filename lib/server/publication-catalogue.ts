import type {Prisma} from "@prisma/client";
import {z} from "zod";
import {db} from "./db";
import {workspaceConfigured} from "./ai-auth";
import {transaction,IntelligenceError} from "./intelligence-service";
import {requireMember,ADMIN} from "./workspace-member";
import {REGULATORY_SOURCES,publicationIsWithdrawn,type RegulatorySource} from "../regulatory-sources.mjs";
import {hashValue} from "../regulatory/intelligence";
import type {AuthorizedContext} from "./authorization";
export const libraryEnabled=()=>workspaceConfigured()&&process.env.REGPILOT_LIBRARY_ENABLED==="true";
export function requireLibrary(){if(!libraryEnabled())throw new IntelligenceError("Obligation library awaits activation",503);}
export const publicationPath=z.string().min(2).max(450).regex(/^\/[a-z0-9][a-z0-9\/-]*$/).refine(p=>!p.includes("//")&&!p.endsWith("/")&&!p.startsWith("/api/"));
export async function boundedPublicJson(url:string,fetcher:typeof fetch=fetch){
 const r=await fetcher(url,{method:"GET",headers:{accept:"application/json"},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(9000)});
 if(!r.ok){await r.body?.cancel();throw new IntelligenceError("Official publication service unavailable",503);}const reader=r.body?.getReader();if(!reader)throw new IntelligenceError("Official response was empty",503);const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1024*1024)throw new IntelligenceError("Official response exceeds the safe size limit",503);chunks.push(value);}return JSON.parse(Buffer.concat(chunks).toString("utf8"));}finally{await reader.cancel().catch(()=>{});}
}
export async function discoverPublications(query:string,offset=0,fetcher:typeof fetch=fetch){
 if(query.trim().length<3||query.length>100||!Number.isInteger(offset)||offset<0||offset>200)throw new IntelligenceError("Use a short publication search and valid page");
 const params=new URLSearchParams({q:query.trim(),count:"20",start:String(offset),fields:"title,link,description,content_store_document_type"});const raw=await boundedPublicJson("https://www.gov.uk/api/search.json?"+params,fetcher);
 if(!raw||!Array.isArray(raw.results))throw new IntelligenceError("Official search response is invalid",503);
 return {items:raw.results.slice(0,20).flatMap((v:any)=>{const path=publicationPath.safeParse(v.link);return path.success&&typeof v.title==="string"?[{path:path.data,title:v.title.slice(0,300),description:typeof v.description==="string"?v.description.slice(0,500):"",documentType:typeof v.content_store_document_type==="string"?v.content_store_document_type.slice(0,120):"unspecified",url:"https://www.gov.uk"+path.data}]:[];}),offset,hasMore:typeof raw.total==="number"&&raw.total>offset+20&&offset<200};
}
export async function resolveWorkspaceSource(tx:Prisma.TransactionClient|typeof db,org:string,sourceId:string):Promise<RegulatorySource|null>{
 const base=REGULATORY_SOURCES.find(s=>s.id===sourceId);if(base)return base;
 const row=await tx.registeredSource.findUnique({where:{organizationId_sourceId:{organizationId:org,sourceId}}});return row?{id:row.sourceId,path:row.path,title:row.title,agency:"GOV.UK",topic:"Registered publication"}:null;
}
export async function workspaceCatalogue(ctx:AuthorizedContext){return transaction(ctx,async tx=>{await requireMember(tx,ctx);const extra=await tx.registeredSource.findMany({where:{organizationId:ctx.organizationId},orderBy:{title:"asc"},take:200});return [...REGULATORY_SOURCES,...extra.map(r=>({id:r.sourceId,path:r.path,title:r.title,agency:"GOV.UK",topic:"Registered publication"}))];});}
export async function registerPublication(ctx:AuthorizedContext,input:unknown,fetcher:typeof fetch=fetch){
 requireLibrary();const parsed=z.object({path:publicationPath}).safeParse(input);if(!parsed.success)throw new IntelligenceError("Choose an official GOV.UK publication path");
 await transaction(ctx,tx=>requireMember(tx,ctx,ADMIN));
 const raw=await boundedPublicJson("https://www.gov.uk/api/content"+parsed.data.path,fetcher);
 // Do not silently follow renamed publications, external redirects or withdrawn content.
 if(!raw||raw.base_path!==parsed.data.path||typeof raw.title!=="string"||typeof raw.document_type!=="string"||raw.document_type==="redirect"||publicationIsWithdrawn(raw))throw new IntelligenceError("Publication identity changed, was withdrawn or is unsupported; inspect the original",409);
 const base=REGULATORY_SOURCES.find(s=>s.path===parsed.data.path);if(base)return {sourceId:base.id,reused:true};
 return transaction(ctx,async tx=>{await requireMember(tx,ctx,ADMIN);requireLibrary();const sourceId="govuk-"+hashValue(parsed.data.path).slice(0,32);const old=await tx.registeredSource.findUnique({where:{organizationId_sourceId:{organizationId:ctx.organizationId,sourceId}}});if(old)return {sourceId,reused:true};if(await tx.registeredSource.count({where:{organizationId:ctx.organizationId}})>=200)throw new IntelligenceError("This organisation's 200-publication pilot limit has been reached",429);
 const row=await tx.registeredSource.create({data:{organizationId:ctx.organizationId,sourceId,path:parsed.data.path,title:raw.title.slice(0,300),documentType:raw.document_type.slice(0,120),registeredById:ctx.userId}});await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"publication.registered",entityType:"RegisteredSource",entityId:row.id,details:{sourceId}}});return {sourceId,reused:false};});
}
