import {Prisma,type CoverageRun} from "@prisma/client";
import {z} from "zod";
import {db} from "./db";
import {transaction,IntelligenceError} from "./intelligence-service";
import type {AuthorizedContext} from "./authorization";
import {requireMember,ADMIN,WRITER} from "./workspace-member";
import {libraryEnabled,requireLibrary} from "./publication-catalogue";
import {revisionContext,activeOwner} from "./library-service";
import {COVERAGE_ENGINE,searchCoverage,groundCoverage,type CoverageInput,type CoverageResult} from "../library/coverage";
import {hashValue} from "../regulatory/intelligence";
import {aiConfigured} from "./ai-auth";
import {reserveAiRequest,DailyLimitError} from "./ai-meter";
import {generateCoverage} from "./coverage-model";
import {downloadEvidence} from "./evidence-service";
import {evidenceConfigured,type EvidenceObjectStore} from "./evidence-storage";
import {extractDocument} from "./document-extraction";
import {extractionBlocked} from "../documents/coverage";
const j=(v:unknown)=>v as Prisma.InputJsonValue;
const ids=(max:number,min=1)=>z.array(z.uuid()).min(min).max(max).refine(v=>new Set(v).size===v.length).transform(v=>v.sort());
const inputSchema=z.object({revisionIds:ids(12),controlIds:ids(30),evidenceIds:ids(3,0),method:z.enum(["SEARCH","AI"]),consent:z.literal(true),retry:z.boolean().default(false)});
export const coverageAiEnabled=()=>libraryEnabled()&&aiConfigured()&&process.env.REGPILOT_LIBRARY_AI_ENABLED==="true";
type Selection={revisionIds:string[];controlIds:string[];evidenceIds:string[]};
type RevisionCache=Map<string,Awaited<ReturnType<typeof revisionContext>>>;
async function gather(tx:Prisma.TransactionClient,ctx:AuthorizedContext,selection:Selection,cache?:RevisionCache){
 const requirements:CoverageInput["requirements"]=[],requirementsManifest:Array<{id:string;contextHash:string;applicabilityId:string;applicabilityVersion:number;ownerId:string}>=[];
 for(const id of selection.revisionIds){const c=cache?.get(id)||await revisionContext(tx,ctx,id);cache?.set(id,c);if(!c.current||!c.content||c.applicability?.decision!=="APPLIES"||!c.applicability.ownerId)throw new IntelligenceError("All selected requirements need current source approval and an applicability decision with an active owner",409);await activeOwner(tx,ctx,c.applicability.ownerId);
 requirements.push({id,collection:c.revision.requirement.collection,reference:c.revision.requirement.reference,content:c.content});requirementsManifest.push({id,contextHash:c.contextHash,applicabilityId:c.applicability.id,applicabilityVersion:c.applicability.version,ownerId:c.applicability.ownerId});}
 const controls=await tx.managedControl.findMany({where:{organizationId:ctx.organizationId,id:{in:selection.controlIds}},include:{programmeImport:{select:{status:true,result:true,resultHash:true,evidenceManifest:true}}},orderBy:{id:"asc"}});
 if(controls.length!==selection.controlIds.length||controls.some(c=>!c.enabled||c.programmeImport.status!=="ACCEPTED"||hashValue(c.programmeImport.result)!==c.programmeImport.resultHash))throw new IntelligenceError("Select active, independently approved controls from this organisation",409);
 const programmes=[...new Map(controls.map(c=>[c.importId,c.programmeImport])).values()];
 const originalIds=[...new Set(programmes.flatMap(p=>(p.evidenceManifest as unknown as Array<{id:string}>).map(e=>e.id)))];
 const originals=await tx.evidence.findMany({where:{organizationId:ctx.organizationId,id:{in:originalIds}},select:{id:true,sha256:true,scanStatus:true,reviewStatus:true,reviewVersion:true,uploadedById:true,reviewerId:true},orderBy:{id:"asc"}});
 for(const p of programmes){const expected=p.evidenceManifest as unknown as Array<{id:string}>;if(hashValue(originals.filter(e=>expected.some(v=>v.id===e.id)))!==hashValue(expected))throw new IntelligenceError("A control's original programme evidence changed; review its programme before mapping",409);}
 for(const c of controls)await activeOwner(tx,ctx,c.ownerId);
 const evidence=await tx.evidence.findMany({where:{organizationId:ctx.organizationId,id:{in:selection.evidenceIds}},orderBy:{id:"asc"},select:{id:true,sha256:true,reviewVersion:true,scanStatus:true,reviewStatus:true,reviewerId:true,uploadedById:true}});
 if(evidence.length!==selection.evidenceIds.length||evidence.some(e=>e.scanStatus!=="CLEAN"||e.reviewStatus!=="APPROVED"||!e.reviewerId||e.reviewerId===e.uploadedById))throw new IntelligenceError("Select clean, independently approved evidence",409);
 const manifest={engine:COVERAGE_ENGINE,selection,requirements:requirementsManifest,controls:controls.map(c=>({id:c.id,version:c.version,hash:hashValue({title:c.title,description:c.description,testProcedure:c.testProcedure,ownerId:c.ownerId,programmeHash:c.programmeImport.resultHash})})),evidence};
 return {manifest,input:{requirements,controls:controls.map(c=>({id:c.id,title:c.title,description:c.description,testProcedure:c.testProcedure})),documents:[]} as CoverageInput};
}
export async function prepareCoverage(ctx:AuthorizedContext,input:unknown,deps:{storage?:EvidenceObjectStore;generate?:typeof generateCoverage}={}){
 requireLibrary();const d=inputSchema.parse(input),selection:Selection={revisionIds:d.revisionIds,controlIds:d.controlIds,evidenceIds:d.evidenceIds};if(d.method==="AI"&&!coverageAiEnabled())throw new IntelligenceError("AI relationship analysis awaits activation",503);
 if(d.evidenceIds.length&&!evidenceConfigured())throw new IntelligenceError("Private evidence processing awaits activation",503);
 const reserved=await transaction(ctx,async tx=>{await requireMember(tx,ctx,WRITER);requireLibrary();const current=await gather(tx,ctx,selection),inputHash=hashValue(current.manifest);
 const old=await tx.coverageRun.findUnique({where:{organizationId_inputHash_method:{organizationId:ctx.organizationId,inputHash,method:d.method}}});if(old){
 if(!d.retry)return {row:old,current,reused:true};
 if(old.attempts>=3||!(old.status==="FAILED"||old.status==="PROCESSING"&&Date.now()-old.lastStartedAt.getTime()>600000))throw new IntelligenceError("Retry only failed or interrupted analysis, at most three attempts",409);
 const row=await tx.coverageRun.update({where:{id:old.id},data:{status:"PROCESSING",result:Prisma.DbNull,resultHash:null,createdById:ctx.userId,version:{increment:1},attempts:{increment:1},lastStartedAt:new Date()}});return {row,current,reused:false};}
 if(await tx.coverageRun.count({where:{organizationId:ctx.organizationId,createdAt:{gte:new Date(Date.now()-86400000)}}})>=15)throw new IntelligenceError("Daily limit of 15 relationship analyses reached",429);
 const row=await tx.coverageRun.create({data:{organizationId:ctx.organizationId,createdById:ctx.userId,inputHash,method:d.method,context:j(current.manifest)}});return {row,current,reused:false};});
 const {row,current}=reserved;if(reserved.reused)return {id:row.id,reused:true};
 try{
 for(const saved of current.manifest.evidence){const file=await downloadEvidence(ctx,saved.id,deps.storage);if(file.sha256!==saved.sha256)throw new IntelligenceError("Evidence bytes changed",409);const pdf=await extractDocument(file.bytes,file.filename);if(extractionBlocked(pdf))throw new IntelligenceError("Incomplete evidence extraction; choose complete, readable documents",409);current.input.documents.push({id:saved.id,pages:pdf.pages,unitKind:pdf.unitKind});}
 if(JSON.stringify(current.input).length>65000)throw new IntelligenceError("Selection exceeds 65,000 characters; use fewer requirements, controls or pages",413);
 await transaction(ctx,async tx=>{await requireMember(tx,ctx,WRITER);if(hashValue((await gather(tx,ctx,selection)).manifest)!==row.inputHash)throw new IntelligenceError("Inputs changed during preparation",409);});
 requireLibrary();if(d.method==="AI"){if(!coverageAiEnabled())throw new IntelligenceError("AI analysis was disabled",503);await reserveAiRequest(ctx,"library-coverage");}
 const result=d.method==="AI"?groundCoverage(await (deps.generate||generateCoverage)(current.input),current.input):searchCoverage(current.input);
 await transaction(ctx,async tx=>{await requireMember(tx,ctx,WRITER);requireLibrary();if(d.method==="AI"&&!coverageAiEnabled()||hashValue((await gather(tx,ctx,selection)).manifest)!==row.inputHash)throw new IntelligenceError("Analysis context changed; result discarded",409);
 const saved=await tx.coverageRun.updateMany({where:{id:row.id,organizationId:ctx.organizationId,status:"PROCESSING",version:row.version},data:{status:"DRAFT",result:j(result),resultHash:hashValue(result)}});if(!saved.count)throw new IntelligenceError("Analysis was removed or superseded",409);
 await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"library.coverage_prepared",entityType:"CoverageRun",entityId:row.id,details:{inputHash:row.inputHash,resultHash:hashValue(result),mappings:result.mappings.length,rejected:result.rejected,method:d.method}}});});return {id:row.id,reused:false};
 }catch(e){await db.coverageRun.updateMany({where:{id:row.id,organizationId:ctx.organizationId,status:"PROCESSING",version:row.version},data:{status:"FAILED"}});if(e instanceof DailyLimitError)throw new IntelligenceError(e.message,429);throw e;}
}
async function runState(tx:Prisma.TransactionClient,ctx:AuthorizedContext,row:CoverageRun,cache?:RevisionCache){
 const integrity=!!row.result&&hashValue(row.result)===row.resultHash&&hashValue(row.context)===row.inputHash;
 if(!integrity||row.status!=="DRAFT")return {current:false,reason:row.status==="REDACTED"?"Retained analysis removed":"Analysis is unavailable or failed integrity checks"};
 try{const current=await gather(tx,ctx,(row.context as unknown as {selection:Selection}).selection,cache);return hashValue(current.manifest)===row.inputHash?{current:true,reason:"Inputs match the reviewed context"}:{current:false,reason:"Source, business facts, applicability, control or evidence version changed"};}catch(e){if(!(e instanceof IntelligenceError))throw e;return {current:false,reason:e.message};}
}
export async function coverageDetail(ctx:AuthorizedContext,id:string){return transaction(ctx,async tx=>{await requireMember(tx,ctx);const row=await tx.coverageRun.findFirst({where:{id,organizationId:ctx.organizationId},include:{decisions:{orderBy:{createdAt:"desc"}}}});if(!row)throw new IntelligenceError("Relationship analysis not found",404);const state=await runState(tx,ctx,row);return {...row,result:row.result&&hashValue(row.result)===row.resultHash?row.result:null,...state,aiEnabled:coverageAiEnabled()};});}
export async function reviewCoverage(ctx:AuthorizedContext,id:string,input:unknown,deps:{storage?:EvidenceObjectStore}={}){
 requireLibrary();const d=z.object({version:z.number().int().positive(),key:z.string().regex(/^[a-f0-9]{64}$/),decision:z.enum(["ACCEPTED","DISMISSED","WITHDRAWN"]),rationale:z.string().trim().min(40).max(1200),scopeConfirmed:z.literal(true)}).parse(input);
 const before=await transaction(ctx,async tx=>{await requireMember(tx,ctx,ADMIN);const row=await tx.coverageRun.findFirst({where:{id,organizationId:ctx.organizationId}});if(!row)throw new IntelligenceError("Analysis not found",404);if(d.decision==="ACCEPTED"&&!(await runState(tx,ctx,row)).current)throw new IntelligenceError("Analysis context changed; prepare a fresh analysis",409);return row;});
 const manifest=before.context as unknown as Awaited<ReturnType<typeof gather>>["manifest"];
 if(d.decision==="ACCEPTED"&&manifest.evidence.length){if(!evidenceConfigured())throw new IntelligenceError("Evidence processing awaits activation",503);for(const e of manifest.evidence){const file=await downloadEvidence(ctx,e.id,deps.storage);if(file.sha256!==e.sha256)throw new IntelligenceError("Evidence bytes changed",409);}}
 return transaction(ctx,async tx=>{await requireMember(tx,ctx,ADMIN);requireLibrary();const row=await tx.coverageRun.findFirst({where:{id,organizationId:ctx.organizationId}});if(!row||row.version!==d.version||row.status!=="DRAFT"||!row.result||hashValue(row.result)!==row.resultHash)throw new IntelligenceError("Analysis changed; refresh before reviewing",409);
 const proposal=(row.result as unknown as CoverageResult).mappings.find(m=>m.key===d.key);if(!proposal)throw new IntelligenceError("Unknown relationship proposal");
 const old=await tx.coverageDecision.findUnique({where:{runId_key:{runId:id,key:d.key}}});
 if(d.decision==="WITHDRAWN"){if(old?.decision!=="ACCEPTED")throw new IntelligenceError("Only an accepted relationship can be withdrawn",409);await tx.coverageDecision.update({where:{id:old.id},data:{decision:"WITHDRAWN",rationale:d.rationale,reviewerId:ctx.userId}});}
 else{if(old)throw new IntelligenceError("This relationship has already been reviewed",409);
 if(d.decision==="ACCEPTED"){if(!(await runState(tx,ctx,row)).current)throw new IntelligenceError("Analysis is stale; prepare it again",409);if(row.createdById===ctx.userId||manifest.evidence.some(e=>e.uploadedById===ctx.userId))throw new IntelligenceError("A different administrator from the analyst and evidence uploaders must review",403);if(proposal.relation==="CONFLICT")throw new IntelligenceError("A conflicting relationship cannot count as an accepted mapping",409);}
 await tx.coverageDecision.create({data:{organizationId:ctx.organizationId,runId:id,key:d.key,revisionId:proposal.revisionId,controlId:proposal.controlId,reviewerId:ctx.userId,decision:d.decision,rationale:d.rationale}});}
 await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"library.relationship_reviewed",entityType:"CoverageRun",entityId:id,details:{key:d.key,decision:d.decision}}});return {id};});
}
export async function coverageImpact(ctx:AuthorizedContext,createTasks=false){
 if(createTasks)requireLibrary();return transaction(ctx,async tx=>{await requireMember(tx,ctx,createTasks?ADMIN:undefined);if(createTasks)requireLibrary();
 // A bounded page is explicit in the response; never report a whole-library compliance score.
 const cache:RevisionCache=new Map();
 const decisions=await tx.coverageDecision.findMany({where:{organizationId:ctx.organizationId},orderBy:[{createdAt:"desc"},{id:"desc"}],take:101,include:{run:true,revision:{include:{requirement:true}},control:{select:{id:true,title:true,ownerId:true}}}}),seen=new Set<string>(),states=new Map<string,Awaited<ReturnType<typeof runState>>>();
 const items:Array<{decisionId:string;revisionId:string;reference:string;collection:string;controlId:string;controlTitle:string;current:boolean;reason:string;taskId:string|null}>=[];let created=0;
 for(const d of decisions.slice(0,100)){const pair=d.revision.requirementId+":"+d.controlId;if(seen.has(pair))continue;seen.add(pair);if(d.decision!=="ACCEPTED")continue;
 let state=states.get(d.runId);if(!state){state=await runState(tx,ctx,d.run,cache);states.set(d.runId,state);}let taskId:string|null=null;
 if(!state.current&&createTasks){const automationKey=hashValue({kind:"library-impact",decisionId:d.id});const old=await tx.obligation.findFirst({where:{organizationId:ctx.organizationId,automationKey}});if(old)taskId=old.id;else{let ownerId=d.control.ownerId;try{await activeOwner(tx,ctx,ownerId);}catch(e){if(!(e instanceof IntelligenceError))throw e;ownerId=ctx.userId;}
 const task=await tx.obligation.create({data:{organizationId:ctx.organizationId,title:("Review changed requirement: "+d.revision.requirement.reference).slice(0,200),notes:"Review the current requirement and its control relationship in the obligation library. "+state.reason,sourceUrl:null,category:"Requirement review",ownerName:(await activeOwner(tx,ctx,ownerId)).user.email,assigneeId:ownerId,controlId:d.controlId,automationKey,dueDate:new Date(Date.now()+7*86400000),status:"OPEN"}});taskId=task.id;created++;}}
 items.push({decisionId:d.id,revisionId:d.revisionId,reference:d.revision.requirement.reference,collection:d.revision.requirement.collection,controlId:d.controlId,controlTitle:d.control.title,...state,taskId});}
 if(createTasks)await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"library.impact_tasks_generated",entityType:"Organization",entityId:ctx.organizationId,details:{created,examined:decisions.length,truncated:decisions.length>100}}});
 return {items,created,truncated:decisions.length>100,acceptedCurrent:items.filter(i=>i.current).length,needsReview:items.filter(i=>!i.current).length,note:"Counts cover up to 100 latest decisions. Relationships describe scope, not evidence sufficiency. Review target dates are operational targets, not legal deadlines."};});
}
export async function redactCoverage(ctx:AuthorizedContext,id:string,version:number){
 return transaction(ctx,async tx=>{await requireMember(tx,ctx,ADMIN);const changed=await tx.coverageRun.updateMany({where:{id,organizationId:ctx.organizationId,version,status:{not:"REDACTED"}},data:{result:Prisma.DbNull,resultHash:null,context:{},status:"REDACTED",version:{increment:1}}});if(!changed.count)throw new IntelligenceError("Analysis changed",409);await tx.coverageDecision.updateMany({where:{runId:id,organizationId:ctx.organizationId},data:{rationale:"Retained content removed"}});await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"library.coverage_removed",entityType:"CoverageRun",entityId:id,details:{}}});return {id};});
}
