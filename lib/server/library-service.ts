import {Prisma,type LibraryRevision} from "@prisma/client";
import {z} from "zod";
import {db} from "./db";
import type {AuthorizedContext} from "./authorization";
import {transaction,IntelligenceError} from "./intelligence-service";
import {ADMIN,WRITER,requireMember} from "./workspace-member";
import {requireLibrary,libraryEnabled} from "./publication-catalogue";
import {factsSchema,parseRule,evaluateRule} from "../library/applicability";
import {uniqueQuote,type RequirementContent} from "../library/coverage";
import {hashValue} from "../regulatory/intelligence";
import {sourceTextHash} from "../regulatory/source-fingerprint.mjs";
import {downloadEvidence} from "./evidence-service";
import {extractPdf} from "./pdf-extraction";
import {evidenceConfigured,type EvidenceObjectStore} from "./evidence-storage";
import {allowedEmail} from "../ai/security.mjs";
const j=(v:unknown)=>v as Prisma.InputJsonValue;
const nation=z.enum(["England","Scotland","Wales","Northern Ireland"]);
const clauseSchema=z.object({reference:z.string().trim().min(1).max(100),title:z.string().trim().min(3).max(180),quote:z.string().trim().min(20).max(3000),kind:z.enum(["DUTY","PROHIBITION","GUIDANCE","STANDARD","EXEMPTION"]),conditions:z.array(z.string().trim().min(5).max(600)).max(6),exceptions:z.array(z.string().trim().min(5).max(600)).max(6),rule:z.unknown().default(null),page:z.number().int().min(1).max(40).optional()});
const intakeSchema=z.object({collection:z.string().trim().min(2).max(100),source:z.discriminatedUnion("type",[z.object({type:z.literal("PUBLICATION"),id:z.uuid()}),z.object({type:z.literal("PDF"),id:z.uuid()})]),clauses:z.array(clauseSchema).min(1).max(25).refine(v=>new Set(v.map(c=>c.reference)).size===v.length),rightsConfirmed:z.literal(true),consent:z.literal(true)});
export type Provenance={type:"PUBLICATION"|"PDF";id:string;fingerprint:string;authorId:string|null;url:string|null;name:string;page?:number;start:number;end:number};
async function sourceState(tx:Prisma.TransactionClient,org:string,type:Provenance["type"],id:string){
 if(type==="PUBLICATION"){
  const s=await tx.regulatorySnapshot.findFirst({where:{id,organizationId:org}});if(!s)throw new IntelligenceError("Publication snapshot not found",404);
  const latest=await tx.regulatorySnapshot.findFirst({where:{organizationId:org,sourceId:s.sourceId},orderBy:[{firstCapturedAt:"desc"},{id:"desc"}]});
  const valid=s.contentHash===sourceTextHash(s.bodyText)&&latest?.id===s.id&&s.reviewStatus==="REVIEWED"&&!!s.reviewerId&&s.reviewerId!==s.capturedById&&Date.now()-s.lastCheckedAt.getTime()<7*86400000;
  return {fingerprint:hashValue({id:s.id,hash:s.contentHash,version:s.version}),valid,reason:"Publication is changed, unreviewed, unavailable or more than seven days since its last check",authorId:s.capturedById,url:s.url,name:s.title,text:s.bodyText};
 }
 const e=await tx.evidence.findFirst({where:{id,organizationId:org}});if(!e)throw new IntelligenceError("Private evidence file not found",404);
 if(e.contentType!=="application/pdf")throw new IntelligenceError("Exact clause intake currently requires a PDF; use Word files in programme import and evidence assessment",415);
 const valid=e.scanStatus==="CLEAN"&&e.reviewStatus==="APPROVED"&&!!e.reviewerId&&e.reviewerId!==e.uploadedById;
 return {fingerprint:hashValue({id:e.id,hash:e.sha256,version:e.reviewVersion,status:e.reviewStatus,scan:e.scanStatus,reviewer:e.reviewerId}),valid,reason:"Evidence approval, scan or content has changed",authorId:e.uploadedById,url:null,name:e.filename,text:""};
}
export async function activeOwner(tx:Prisma.TransactionClient,ctx:AuthorizedContext,id:string){
 const m=await tx.membership.findUnique({where:{organizationId_userId:{organizationId:ctx.organizationId,userId:id}},include:{user:{select:{email:true}}}});
 if(!m||m.role==="VIEWER"||!allowedEmail(m.user.email,process.env.REGPILOT_AI_ALLOWED_EMAILS))throw new IntelligenceError("Choose an active team member who can own work",409);
 return m;
}
export async function saveLibraryFacts(ctx:AuthorizedContext,input:unknown){
 requireLibrary();const d=z.object({version:z.number().int().nonnegative(),facts:factsSchema,jurisdictions:z.array(nation).min(1).max(4).refine(v=>new Set(v).size===v.length)}).parse(input);
 return transaction(ctx,async tx=>{await requireMember(tx,ctx,ADMIN);requireLibrary();const old=await tx.businessProfile.findUnique({where:{organizationId:ctx.organizationId}});if((old?.version||0)!==d.version)throw new IntelligenceError("Business facts changed; refresh first",409);
 const row=await tx.businessProfile.upsert({where:{organizationId:ctx.organizationId},create:{organizationId:ctx.organizationId,activities:[],jurisdictions:d.jurisdictions,facts:j(d.facts),updatedById:ctx.userId},update:{jurisdictions:d.jurisdictions,facts:j(d.facts),version:{increment:1},updatedById:ctx.userId}});
 await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"library.business_facts_updated",entityType:"BusinessProfile",entityId:ctx.organizationId,details:{version:row.version}}});return {version:row.version};});
}
export async function draftRequirements(ctx:AuthorizedContext,input:unknown,deps:{storage?:EvidenceObjectStore}={}){
 requireLibrary();const d=intakeSchema.parse(input);let clauses:Array<Omit<z.infer<typeof clauseSchema>,"rule">&{rule:ReturnType<typeof parseRule>}>;
 try{clauses=d.clauses.map(c=>({...c,rule:parseRule(c.rule)}));}catch{throw new IntelligenceError("Check the applicability rule structure");}
 const original=await transaction(ctx,async tx=>{await requireMember(tx,ctx,WRITER);const s=await sourceState(tx,ctx.organizationId,d.source.type,d.source.id);if(!s.valid)throw new IntelligenceError(s.reason,409);return s;});
 let pages:Array<{page:number;text:string}>=[];
 if(d.source.type==="PDF"){if(!evidenceConfigured())throw new IntelligenceError("Private evidence processing is not activated",503);const file=await downloadEvidence(ctx,d.source.id,deps.storage),pdf=await extractPdf(file.bytes);if(pdf.truncated||pdf.skippedPages.length)throw new IntelligenceError("Incomplete extraction: use a shorter, readable PDF before importing clauses",409);pages=pdf.pages;}
 const prepared=clauses.map(c=>{const text=d.source.type==="PDF"?pages.find(p=>p.page===c.page)?.text||"":original.text;
  if(!uniqueQuote(text,c.quote)||[...c.conditions,...c.exceptions].some(q=>!uniqueQuote(text,q)))throw new IntelligenceError("Every requirement, condition and exception must be an exact, unique quotation from the selected source page",409);
  const content:RequirementContent={title:c.title,quote:c.quote,kind:c.kind,conditions:c.conditions,exceptions:c.exceptions,rule:c.rule};
  const provenance:Provenance={type:d.source.type,id:d.source.id,fingerprint:original.fingerprint,authorId:original.authorId,url:original.url,name:original.name,...(d.source.type==="PDF"?{page:c.page}:{}),start:text.indexOf(c.quote),end:text.indexOf(c.quote)+c.quote.length};return {reference:c.reference,content,provenance};
 });
 return transaction(ctx,async tx=>{await requireMember(tx,ctx,WRITER);requireLibrary();const fresh=await sourceState(tx,ctx.organizationId,d.source.type,d.source.id);if(!fresh.valid||fresh.fingerprint!==original.fingerprint)throw new IntelligenceError("Source changed during import",409);
 const count=await tx.libraryRequirement.count({where:{organizationId:ctx.organizationId}});let added=0;const revisions:string[]=[];
 for(const p of prepared){let requirement=await tx.libraryRequirement.findUnique({where:{organizationId_collection_reference:{organizationId:ctx.organizationId,collection:d.collection,reference:p.reference}}});if(!requirement){if(count+ ++added>1000)throw new IntelligenceError("Organisation pilot limit of 1,000 requirements reached",429);requirement=await tx.libraryRequirement.create({data:{organizationId:ctx.organizationId,collection:d.collection,reference:p.reference}});}
 const latest=await tx.libraryRevision.findFirst({where:{organizationId:ctx.organizationId,requirementId:requirement.id},orderBy:{number:"desc"}}),contentHash=hashValue(p.content),provenanceHash=hashValue(p.provenance);
 if(latest?.contentHash===contentHash&&latest.provenanceHash===provenanceHash&&["DRAFT","ACCEPTED"].includes(latest.status)){revisions.push(latest.id);continue;}
 if(latest?.status==="DRAFT")throw new IntelligenceError("Review or reject the existing draft for "+p.reference+" before preparing another revision",409);
 const row=await tx.libraryRevision.create({data:{organizationId:ctx.organizationId,requirementId:requirement.id,number:(latest?.number||0)+1,content:j(p.content),contentHash,provenance:j(p.provenance),provenanceHash,createdById:ctx.userId}});revisions.push(row.id);
 }
 await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"library.revisions_drafted",entityType:"LibraryRevision",entityId:revisions[0],details:{revisionIds:revisions,sourceId:d.source.id}}});return {revisionIds:revisions};});
}
export async function revisionContext(tx:Prisma.TransactionClient,ctx:AuthorizedContext,id:string){
 const r=await tx.libraryRevision.findFirst({where:{id,organizationId:ctx.organizationId},include:{requirement:true}});if(!r)throw new IntelligenceError("Requirement revision not found",404);
 const reasons:string[]=[];if(r.status!=="ACCEPTED"||r.requirement.currentRevision!==r.number)reasons.push("Requirement is not the current approved revision");
 const integrity=hashValue(r.content)===r.contentHash&&hashValue(r.provenance)===r.provenanceHash,p=r.provenance as unknown as Provenance;
 if(!integrity)reasons.push("Requirement integrity check failed");
 let state:Awaited<ReturnType<typeof sourceState>>|null=null;
 if(integrity&&r.status!=="REDACTED")try{state=await sourceState(tx,ctx.organizationId,p.type,p.id);if(!state.valid||state.fingerprint!==p.fingerprint)reasons.push(state.reason);}catch(e){if(!(e instanceof IntelligenceError))throw e;reasons.push("Original source unavailable");}
 const profile=await tx.businessProfile.findUnique({where:{organizationId:ctx.organizationId}});if(!profile)reasons.push("Business facts have not been saved");
 const facts=factsSchema.safeParse(profile?.facts||{}),jurisdictions=Array.isArray(profile?.jurisdictions)?profile!.jurisdictions.filter((v):v is string=>typeof v==="string"):[];
 if(!facts.success)reasons.push("Business facts are invalid");
 const content=integrity&&r.status!=="REDACTED"?r.content as unknown as RequirementContent:null;
 const evaluation=evaluateRule(content?.rule||null,facts.success?facts.data:{},jurisdictions);
 const contextHash=hashValue({revision:r.id,content:r.contentHash,provenance:r.provenanceHash,head:r.requirement.currentRevision,status:r.status,source:state?.fingerprint||null,sourceValid:state?.valid||false,profileVersion:profile?.version||0,facts:profile?.facts||{},jurisdictions});
 const applicability=await tx.libraryApplicability.findUnique({where:{revisionId_contextHash:{revisionId:r.id,contextHash}}});

 return {revision:r,content,provenance:integrity&&r.status!=="REDACTED"?p:null,current:!reasons.length,reasons,contextHash,evaluation,applicability,profileVersion:profile?.version||0};
}
async function verifyRevisionSource(tx:Prisma.TransactionClient,ctx:AuthorizedContext,r:LibraryRevision){
 if(hashValue(r.content)!==r.contentHash||hashValue(r.provenance)!==r.provenanceHash)throw new IntelligenceError("Requirement integrity check failed",409);const p=r.provenance as unknown as Provenance;
 const fresh=await sourceState(tx,ctx.organizationId,p.type,p.id);if(!fresh.valid||fresh.fingerprint!==p.fingerprint)throw new IntelligenceError(fresh.reason,409);return p;
}
export async function reviewRevision(ctx:AuthorizedContext,id:string,input:unknown,deps:{storage?:EvidenceObjectStore}={}){
 requireLibrary();const d=z.object({version:z.number().int().positive(),decision:z.enum(["ACCEPTED","REJECTED","WITHDRAWN"]),notes:z.string().trim().min(40).max(1200),scopeConfirmed:z.literal(true)}).parse(input);
 const pre=await transaction(ctx,async tx=>{await requireMember(tx,ctx,ADMIN);const r=await tx.libraryRevision.findFirst({where:{id,organizationId:ctx.organizationId}});if(!r)throw new IntelligenceError("Revision not found",404);if(d.decision!=="ACCEPTED")return null;
 if(r.createdById===ctx.userId)throw new IntelligenceError("A different administrator must review this revision",403);return verifyRevisionSource(tx,ctx,r);});
 if(pre?.type==="PDF"){if(!evidenceConfigured())throw new IntelligenceError("Private evidence processing is not activated",503);await downloadEvidence(ctx,pre.id,deps.storage);}
 return transaction(ctx,async tx=>{await requireMember(tx,ctx,ADMIN);requireLibrary();const r=await tx.libraryRevision.findFirst({where:{id,organizationId:ctx.organizationId},include:{requirement:true}});if(!r||r.version!==d.version||!(d.decision==="WITHDRAWN"?r.status==="ACCEPTED"&&r.number===r.requirement.currentRevision:r.status==="DRAFT"))throw new IntelligenceError("Revision changed or is not eligible for this decision",409);
 if(d.decision==="ACCEPTED"){const p=await verifyRevisionSource(tx,ctx,r);if(r.createdById===ctx.userId||p.authorId===ctx.userId)throw new IntelligenceError("A different administrator from the author and source uploader must review",403);
 if(r.number<=r.requirement.currentRevision)throw new IntelligenceError("A newer revision is already approved",409);
 await tx.libraryRevision.updateMany({where:{organizationId:ctx.organizationId,requirementId:r.requirementId,status:"ACCEPTED"},data:{status:"SUPERSEDED",version:{increment:1}}});
 await tx.libraryRequirement.update({where:{id:r.requirementId},data:{currentRevision:r.number,version:{increment:1}}});}
 await tx.libraryRevision.update({where:{id},data:{status:d.decision,reviewerId:ctx.userId,reviewNotes:d.notes,reviewedAt:new Date(),version:{increment:1}}});
 await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"library.revision_reviewed",entityType:"LibraryRevision",entityId:id,details:{decision:d.decision,number:r.number}}});return {id};});
}
export async function decideApplicability(ctx:AuthorizedContext,id:string,input:unknown){
 requireLibrary();const d=z.object({contextHash:z.string().regex(/^[a-f0-9]{64}$/),version:z.number().int().nonnegative(),decision:z.enum(["APPLIES","NOT_APPLICABLE"]),rationale:z.string().trim().min(40).max(1200),ownerId:z.uuid().nullable(),scopeConfirmed:z.literal(true)}).parse(input);
 return transaction(ctx,async tx=>{await requireMember(tx,ctx,ADMIN);requireLibrary();const c=await revisionContext(tx,ctx,id);if(!c.current||c.contextHash!==d.contextHash||(c.applicability?.version||0)!==d.version)throw new IntelligenceError("Requirement, source or business facts changed; review the current context",409);
 if(d.decision==="APPLIES"){if(!d.ownerId)throw new IntelligenceError("Choose an owner");await activeOwner(tx,ctx,d.ownerId);}
 const values={decision:d.decision,rationale:d.rationale,ownerId:d.decision==="APPLIES"?d.ownerId:null,reviewerId:ctx.userId,profileVersion:c.profileVersion};
 const row=await tx.libraryApplicability.upsert({where:{revisionId_contextHash:{revisionId:id,contextHash:c.contextHash}},create:{organizationId:ctx.organizationId,revisionId:id,contextHash:c.contextHash,...values},update:{...values,version:{increment:1}}});
 await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"library.applicability_reviewed",entityType:"LibraryApplicability",entityId:row.id,details:{decision:d.decision,contextHash:c.contextHash,version:row.version}}});return {id:row.id};});
}
export async function libraryWorkspace(ctx:AuthorizedContext,query={cursor:"",search:"",revisionId:""}){
 return transaction(ctx,async tx=>{await requireMember(tx,ctx);const org=ctx.organizationId,where={organizationId:org,...(query.cursor?{id:{gt:query.cursor}}:{}),...(query.search?{OR:[{reference:{contains:query.search,mode:"insensitive" as const}},{collection:{contains:query.search,mode:"insensitive" as const}}]}:{})};
 const rows=await tx.libraryRequirement.findMany({where,orderBy:{id:"asc"},take:26,include:{revisions:{orderBy:{number:"desc"},take:3}}});
 const heads=await tx.libraryRevision.findMany({where:{organizationId:org,OR:rows.slice(0,25).filter(r=>r.currentRevision>0).map(r=>({requirementId:r.id,number:r.currentRevision}))}});
 for(const r of rows){const head=heads.find(v=>v.requirementId===r.id);if(head&&!r.revisions.some(v=>v.id===head.id))r.revisions.push(head);}
 const items=rows.slice(0,25).map(r=>({...r,revisions:r.revisions.map(v=>({...v,content:hashValue(v.content)===v.contentHash&&v.status!=="REDACTED"?v.content:null,provenance:hashValue(v.provenance)===v.provenanceHash&&v.status!=="REDACTED"?v.provenance:null}))}));
 const profile=await tx.businessProfile.findUnique({where:{organizationId:org}}),analyses=await tx.intelligenceRun.findMany({where:{organizationId:org},orderBy:{createdAt:"desc"},take:20,select:{id:true,snapshotId:true,engineVersion:true,result:true,resultHash:true,createdAt:true}}),members=await tx.membership.findMany({where:{organizationId:org},select:{userId:true,role:true,user:{select:{email:true}}}}),sources=await tx.regulatorySnapshot.findMany({where:{organizationId:org},distinct:["sourceId"],orderBy:{firstCapturedAt:"desc"},take:214,select:{id:true,sourceId:true,title:true,url:true,reviewStatus:true,lastCheckedAt:true}}),evidence=await tx.evidence.findMany({where:{organizationId:org,scanStatus:"CLEAN",reviewStatus:"APPROVED"},orderBy:{createdAt:"desc"},take:50,select:{id:true,filename:true}}),controls=await tx.managedControl.findMany({where:{organizationId:org,enabled:true,programmeImport:{status:"ACCEPTED"}},orderBy:{title:"asc"},take:200,select:{id:true,title:true}}),runs=await tx.coverageRun.findMany({where:{organizationId:org},orderBy:{createdAt:"desc"},take:20,select:{id:true,method:true,status:true,createdAt:true}});
 const selected=query.revisionId?await revisionContext(tx,ctx,query.revisionId):null;
 const history=selected?await tx.libraryRevision.findMany({where:{organizationId:org,requirementId:selected.revision.requirementId},orderBy:{number:"desc"},take:50,select:{id:true,number:true,status:true,createdAt:true,reviewedAt:true,createdById:true,reviewerId:true}}):[];
 return {analyses:analyses.map(a=>({...a,result:hashValue(a.result)===a.resultHash?a.result:null})),enabled:libraryEnabled(),items,nextCursor:rows.length>25?rows[24].id:null,profile,members,evidence,controls,sources,runs,selected,history};});
}
export async function importIntelligenceCandidates(ctx:AuthorizedContext,input:unknown){
 requireLibrary();const d=z.object({runId:z.uuid(),collection:z.string().trim().min(2).max(100),keys:z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1).max(25),consent:z.literal(true),rightsConfirmed:z.literal(true)}).parse(input);
 const run=await transaction(ctx,async tx=>{await requireMember(tx,ctx,WRITER);const r=await tx.intelligenceRun.findFirst({where:{id:d.runId,organizationId:ctx.organizationId}});if(!r||hashValue(r.result)!==r.resultHash)throw new IntelligenceError("Source analysis unavailable",404);return r;});
 const result=run.result as unknown as import("../regulatory/intelligence").Analysis,selected=result.candidates.filter(c=>d.keys.includes(c.key));if(selected.length!==d.keys.length)throw new IntelligenceError("Select distinct available recommendations");
 return draftRequirements(ctx,{collection:d.collection,source:{type:"PUBLICATION",id:run.snapshotId},rightsConfirmed:true,consent:true,clauses:selected.map(c=>({reference:c.key.slice(0,16),title:(c.interpretation?.action||c.quote).slice(0,180),quote:c.quote,kind:c.language==="prohibition"?"PROHIBITION":c.language==="exemption"?"EXEMPTION":c.language==="recommendation"?"GUIDANCE":"DUTY",conditions:c.interpretation?.conditions.map(p=>p.quote)||[],exceptions:c.interpretation?.exceptions.map(p=>p.quote)||[],rule:null}))});
}
export async function redactRevision(ctx:AuthorizedContext,id:string,version:number){
 return transaction(ctx,async tx=>{await requireMember(tx,ctx,ADMIN);const row=await tx.libraryRevision.findFirst({where:{id,organizationId:ctx.organizationId}});if(!row||row.version!==version||row.status==="REDACTED")throw new IntelligenceError("Revision changed",409);
 await tx.libraryRevision.update({where:{id},data:{status:"REDACTED",content:{},contentHash:hashValue({}),provenance:{},provenanceHash:hashValue({}),reviewNotes:"",version:{increment:1}}});
 await tx.libraryApplicability.updateMany({where:{revisionId:id,organizationId:ctx.organizationId},data:{rationale:"Retained content removed",version:{increment:1}}});
 const affected=await tx.coverageRun.findMany({where:{organizationId:ctx.organizationId,context:{path:["selection","revisionIds"],array_contains:[id]}},select:{id:true}}),runIds=affected.map(r=>r.id);
 await tx.coverageRun.updateMany({where:{organizationId:ctx.organizationId,id:{in:runIds}},data:{status:"REDACTED",context:{},result:Prisma.DbNull,resultHash:null,version:{increment:1}}});await tx.coverageDecision.updateMany({where:{organizationId:ctx.organizationId,runId:{in:runIds}},data:{rationale:"Retained content removed"}});
 await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"library.revision_removed",entityType:"LibraryRevision",entityId:id,details:{affectedAnalyses:runIds.length}}});return {id};});
}
