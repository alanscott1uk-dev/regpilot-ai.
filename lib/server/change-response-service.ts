import {Prisma,type ChangeAction,type ChangeResponse} from "@prisma/client";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {transaction,IntelligenceError} from "./intelligence-service";
import {requireMember,ADMIN,WRITER} from "./workspace-member";
import {libraryEnabled,requireLibrary,resolveWorkspaceSource} from "./publication-catalogue";
import {officialSourceUrl} from "../regulatory-sources.mjs";
import {sourceTextHash} from "../regulatory/source-fingerprint.mjs";
import {hashValue} from "../regulatory/intelligence";
import {activeOwner,revisionContext} from "./library-service";
import {coverageRunState} from "./coverage-service";
import {reviewedFilesSchema,reviewedFiles,assertReviewedFiles,verifyReviewedBytes,futureDate} from "./reviewed-files";
import type {EvidenceObjectStore} from "./evidence-storage";
import type {AuthorizedContext} from "./authorization";
import {CHANGE_LIMITS,affectedRequirementSchema,changePlanSchema,createChangeSchema,changeActionSchema,closeChangeSchema,groupChangeWork,type ChangePlan} from "../change-response";
type Tx=Prisma.TransactionClient;
const org=(ctx:AuthorizedContext)=>({organizationId:ctx.organizationId});
const requirementsSchema=z.array(affectedRequirementSchema).min(1).max(100);
const mappingSchema=z.object({requirementId:z.uuid(),kind:z.enum(["MAPPING","NOT_APPLICABLE"]),decisionId:z.uuid(),runId:z.uuid().nullable(),inputHash:z.string(),resultHash:z.string()});
const submissionSchema=z.object({notes:z.string(),files:reviewedFilesSchema,mappings:z.array(mappingSchema),submittedAt:z.iso.datetime()});
const historySchema=z.array(z.object({submission:submissionSchema,reviewNotes:z.string(),reviewedAt:z.string().nullable()})).max(CHANGE_LIMITS.history);
const j=(v:unknown)=>v as Prisma.InputJsonValue;
async function event(tx:Tx,ctx:AuthorizedContext,id:string,action:string,details:Prisma.InputJsonValue={}){await tx.auditEvent.create({data:{...org(ctx),actorId:ctx.userId,entityType:"ChangeResponse",entityId:id,action:"change_response."+action,details}});}
function planOf(row:ChangeResponse){const p=changePlanSchema.parse(row.plan);if(hashValue(p)!==row.planHash)throw new IntelligenceError("Response plan integrity check failed",409);return p;}
function submissionOf(row:ChangeAction){const s=submissionSchema.parse(row.submission);if(hashValue(s)!==row.submissionHash)throw new IntelligenceError("Response evidence integrity check failed",409);return s;}
function assertActionPlan(a:ChangeAction,plan:ChangePlan){const group=plan.groups.find(g=>g.controlId===a.controlId);if(!group||hashValue(group.requirements)!==hashValue(a.requirements))throw new IntelligenceError("Action scope no longer matches the approved response plan",409);}
async function linkedEvidence(tx:Tx,ctx:AuthorizedContext,ids:string[]){const files=await tx.evidence.findMany({where:{...org(ctx),id:{in:ids}},select:{id:true,filename:true,sha256:true,reviewVersion:true,reviewStatus:true,scanStatus:true},orderBy:{id:"asc"}});return files.map(f=>({id:f.id,filename:f.filename,reviewStatus:f.reviewStatus,scanStatus:f.scanStatus,fingerprint:hashValue(f)}));}
async function sourceState(tx:Tx,ctx:AuthorizedContext,id:string){
 const s=await tx.regulatorySnapshot.findFirst({where:{id,...org(ctx)}});if(!s)throw new IntelligenceError("Source snapshot not found",404);
 const [latest,source]=await Promise.all([tx.regulatorySnapshot.findFirst({where:{...org(ctx),sourceId:s.sourceId},orderBy:[{firstCapturedAt:"desc"},{id:"desc"}]}),resolveWorkspaceSource(tx,ctx.organizationId,s.sourceId)]);
 const blockers:string[]=[];
 if(!source||s.url!==officialSourceUrl(source)||sourceTextHash(s.bodyText)!==s.contentHash)blockers.push("Source identity or text integrity failed");
 if(latest?.id!==s.id)blockers.push("A newer source snapshot exists. Prepare a response for the latest version");
 if(s.reviewStatus!=="REVIEWED"||!s.reviewerId||s.reviewerId===s.capturedById)blockers.push("An independent administrator must review the changed source first");
 if(Date.now()-s.lastCheckedAt.getTime()>7*86400000)blockers.push("Recheck the official source; its last successful check is over seven days old");
 return {snapshot:s,blockers};
}
async function dependencies(tx:Tx,ctx:AuthorizedContext,controlIds:string[],evidenceIds:string[],prior?:ChangePlan["dependencies"]){
 const contains=evidenceIds.map(id=>({evidenceManifest:{array_contains:[{id}]}}));
 const [policies,suppliers,audits]=await Promise.all([
  tx.policyRevision.findMany({where:{...org(ctx),OR:[{id:{in:prior?.policies.map(p=>p.id)||[]}},{status:"PUBLISHED",OR:evidenceIds.map(id=>({file:{path:["id"],equals:id}}))}]},include:{policy:{select:{title:true,active:true,version:true}}},orderBy:{id:"asc"},take:101}),
  tx.vendorReview.findMany({where:{...org(ctx),OR:[{id:{in:prior?.suppliers.map(p=>p.id)||[]}},{status:"ACCEPTED",OR:contains}]},include:{vendor:{select:{name:true,active:true,version:true}}},orderBy:{id:"asc"},take:101}),
  tx.auditRoom.findMany({where:{...org(ctx),OR:[{id:{in:prior?.audits.map(p=>p.id)||[]}},{status:{in:["DRAFT","PUBLISHED"]},OR:[...evidenceIds.map(id=>({manifest:{path:["files"],array_contains:[{id}]}})),{requests:{some:{controlId:{in:controlIds}}}}]}]},orderBy:{id:"asc"},take:101})
 ]);
 const exceeded=[policies,suppliers,audits].some(a=>a.length>100);
 return {exceeded,items:{policies:policies.slice(0,100).map(p=>({id:p.id,title:p.policy.title,fingerprint:hashValue({status:p.status,version:p.version,fileHash:p.fileHash,policy:p.policy})})),suppliers:suppliers.slice(0,100).map(v=>({id:v.id,title:v.vendor.name,fingerprint:hashValue({status:v.status,version:v.version,inputHash:v.inputHash,vendor:v.vendor})})),audits:audits.slice(0,100).map(a=>({id:a.id,title:a.title,fingerprint:hashValue({status:a.status,version:a.version,manifestHash:a.manifestHash,expiresAt:a.expiresAt})}))}};
}
async function preview(tx:Tx,ctx:AuthorizedContext,snapshotId:string){
 const {snapshot:s,blockers}=await sourceState(tx,ctx,snapshotId);
 const snapshots=await tx.regulatorySnapshot.findMany({where:{...org(ctx),sourceId:s.sourceId},select:{id:true,contentHash:true},orderBy:[{firstCapturedAt:"desc"},{id:"desc"}],take:1001});
 if(snapshots.length>1000)blockers.push("Source history exceeds the supported 1,000-snapshot review window");
 const previous=snapshots.find(p=>p.id!==s.id);if(!previous||previous.contentHash===s.contentHash)blockers.push("This snapshot does not have a distinct earlier text version to compare");
 const identities=await tx.$queryRaw<Array<{id:string}>>`SELECT DISTINCT r."requirementId" AS id FROM "LibraryRevision" r JOIN "RegulatorySnapshot" s ON s.id::text=r.provenance->>'id' AND s."organizationId"=r."organizationId" WHERE r."organizationId"=${ctx.organizationId}::uuid AND s."sourceId"=${s.sourceId} AND r.provenance->>'type'='PUBLICATION' ORDER BY r."requirementId" LIMIT 101`;
 if(identities.length>100)blockers.push("More than 100 requirement identities use this source; a complete plan cannot be prepared within this limit");
 const rows=await tx.coverageDecision.findMany({where:{...org(ctx),decision:{in:["ACCEPTED","WITHDRAWN"]},revision:{requirementId:{in:identities.slice(0,100).map(r=>r.id)}}},include:{revision:{include:{requirement:true}},control:{include:{owner:{select:{email:true}},programmeImport:{select:{evidenceManifest:true}}}},run:true},orderBy:[{createdAt:"desc"},{id:"desc"}],take:501});
 if(rows.length>500)blockers.push("More than 500 mapping decisions need review; no partial action plan can be applied");
 const seen=new Set<string>(),sourceIds=new Set(snapshots.map(s=>s.id)),affected:Array<Parameters<typeof groupChangeWork>[0][number]>=[],evidenceIds=new Set<string>();
 for(const d of rows.slice(0,500)){
  const key=d.revision.requirementId+":"+d.controlId;if(seen.has(key))continue;seen.add(key);if(d.decision!=="ACCEPTED")continue;
  const p=d.revision.provenance as {type?:string;id?:string};if(p.type!=="PUBLICATION"||!p.id||!sourceIds.has(p.id)||p.id===s.id)continue;
  if(hashValue(d.revision.provenance)!==d.revision.provenanceHash||hashValue(d.revision.content)!==d.revision.contentHash||hashValue(d.run.context)!==d.run.inputHash||hashValue(d.run.result)!==d.run.resultHash){blockers.push("A linked requirement or mapping failed integrity checks");continue;}
  if(!d.control.enabled)blockers.push("Reactivate or replace the paused control: "+d.control.title);
  try{await activeOwner(tx,ctx,d.control.ownerId);}catch(e){if(!(e instanceof IntelligenceError))throw e;blockers.push("Assign an active owner to "+d.control.title);}
  affected.push({requirementId:d.revision.requirementId,revisionId:d.revisionId,decisionId:d.id,reference:d.revision.requirement.reference,collection:d.revision.requirement.collection,controlId:d.controlId,controlTitle:d.control.title,controlVersion:d.control.version,ownerId:d.control.ownerId,ownerName:d.control.owner.email});
  const raw=(d.run.context as {selection?:{evidenceIds?:unknown}}).selection?.evidenceIds;
  if(Array.isArray(raw))for(const id of raw)if(typeof id==="string"&&z.uuid().safeParse(id).success)evidenceIds.add(id);
  const originals=z.array(z.object({id:z.uuid()})).safeParse(d.control.programmeImport.evidenceManifest);if(originals.success)for(const e of originals.data)evidenceIds.add(e.id);else blockers.push("A control's original evidence manifest is invalid");
 }
 const groups=groupChangeWork(affected);if(!groups.length)blockers.push("No accepted mappings to an earlier version were found within the inspected relationships");
 if(groups.length>30)blockers.push("More than 30 controls are affected; no partial action plan can be applied");
 if(evidenceIds.size>150)blockers.push("Linked evidence exceeds the 150-file review limit");
 const files=[...evidenceIds].sort().slice(0,150),deps=await dependencies(tx,ctx,groups.map(g=>g.controlId),files);if(deps.exceeded)blockers.push("Linked policies, supplier reviews or audit rooms exceed the 100-per-type review limit");
 const prior=await tx.changeResponse.findMany({where:{...org(ctx),status:"ACTIVE",snapshot:{sourceId:s.sourceId},snapshotId:{not:s.id}},orderBy:{id:"asc"},select:{id:true,version:true,_count:{select:{actions:{where:{status:{not:"ACCEPTED"}}}}}}});
 const evidence=await linkedEvidence(tx,ctx,files);if(evidence.length!==files.length)blockers.push("Some linked evidence is unavailable in this organisation");
 const plan:ChangePlan={version:1,source:{id:s.id,sourceId:s.sourceId,title:s.title,url:s.url,contentHash:s.contentHash,version:s.version,previousId:previous?.id||s.id,previousHash:previous?.contentHash||s.contentHash},groups:groups.slice(0,30),replaces:prior.map(r=>({id:r.id,version:r.version,openActions:r._count.actions})),evidenceIds:files,evidence,dependencies:deps.items};
 return {plan,previewHash:hashValue(plan),blockers:[...new Set(blockers)],summary:{affectedRelationships:affected.length,actions:groups.length,duplicateActionsAvoided:affected.length-groups.length,evidence:files.length},added:s.addedSnippets,removed:s.removedSnippets};
}
export async function previewChangeResponse(ctx:AuthorizedContext,snapshotId:string){return transaction(ctx,async tx=>{await requireMember(tx,ctx,ADMIN);return preview(tx,ctx,snapshotId);});}
export async function createChangeResponse(ctx:AuthorizedContext,input:unknown){requireLibrary();const d=createChangeSchema.parse(input),dueDate=futureDate(d.dueDate);return transaction(ctx,async tx=>{
 await requireMember(tx,ctx,ADMIN);requireLibrary();const existing=await tx.changeResponse.findUnique({where:{organizationId_snapshotId:{organizationId:ctx.organizationId,snapshotId:d.snapshotId}}});if(existing)return {id:existing.id,reused:true};
 const p=await preview(tx,ctx,d.snapshotId);if(p.blockers.length||p.previewHash!==d.previewHash)throw new IntelligenceError(p.blockers[0]||"The impact preview changed. Review it again before creating work",409);
 if(await tx.changeResponse.count({where:org(ctx)})>=CHANGE_LIMITS.responses)throw new IntelligenceError("This pilot supports 100 change responses per organisation",429);
 changePlanSchema.parse(p.plan);const row=await tx.changeResponse.create({data:{...org(ctx),snapshotId:d.snapshotId,createdById:ctx.userId,title:p.plan.source.title,plan:j(p.plan),planHash:p.previewHash}});
 for(const prior of p.plan.replaces){const actions=await tx.changeAction.findMany({where:{...org(ctx),responseId:prior.id}});const resolution={kind:"SUPERSEDED",supersededById:row.id,reviewedAt:new Date().toISOString()};await tx.changeResponse.update({where:{id:prior.id},data:{status:"SUPERSEDED",resolution,resolutionHash:hashValue(resolution),version:{increment:1}}});await tx.obligation.updateMany({where:{...org(ctx),id:{in:actions.map(a=>a.taskId)},status:{not:"COMPLETE"}},data:{status:"COMPLETE",completionException:true,completionRationale:"Replaced by a reviewed response plan for a newer source snapshot. This is not completion of the underlying compliance work.",completedAt:new Date()}});await event(tx,ctx,prior.id,"superseded",{supersededById:row.id});}
 for(const g of p.plan.groups){const task=await tx.obligation.create({data:{...org(ctx),title:("Respond to source change: "+g.controlTitle).slice(0,200),category:"Change response",ownerName:g.ownerName,assigneeId:g.ownerId,controlId:g.controlId,dueDate,sourceUrl:p.plan.source.url,automationKey:hashValue({kind:"change-response",responseId:row.id,controlId:g.controlId}),notes:"Review the updated source, revise the affected requirements and applicability, obtain independent mapping approval, then submit reviewed evidence in Change response. This date is an operational target, not a legal deadline."}});await tx.changeAction.create({data:{...org(ctx),responseId:row.id,controlId:g.controlId,taskId:task.id,requirements:j(g.requirements)}});}
 await event(tx,ctx,row.id,"created",{planHash:p.previewHash,relationships:p.summary.affectedRelationships,actions:p.summary.actions});return {id:row.id,reused:false};
 });}
type MappingCache=Map<string,Awaited<ReturnType<typeof coverageRunState>>>;
async function resolutionMappings(tx:Tx,ctx:AuthorizedContext,a:ChangeAction,cache:MappingCache=new Map()){
 const requirements=requirementsSchema.parse(a.requirements),blockers:string[]=[],proof:z.infer<typeof mappingSchema>[]=[];
 const rows=await tx.coverageDecision.findMany({where:{...org(ctx),decision:{in:["ACCEPTED","WITHDRAWN"]},controlId:a.controlId,revision:{requirementId:{in:requirements.map(r=>r.requirementId)}}},include:{revision:true,run:true},orderBy:[{createdAt:"desc"},{id:"desc"}],take:501});
 if(rows.length>500)blockers.push("Mapping history exceeds the supported review limit");const states=cache;
 for(const required of requirements){
  const head=await tx.libraryRequirement.findFirst({where:{id:required.requirementId,...org(ctx)},include:{revisions:{where:{status:"ACCEPTED"},orderBy:{number:"desc"},take:1}}});const revision=head?.revisions[0];
  if(revision){const c=await revisionContext(tx,ctx,revision.id);if(c.current&&c.applicability?.decision==="NOT_APPLICABLE"){proof.push({requirementId:required.requirementId,kind:"NOT_APPLICABLE",decisionId:c.applicability.id,runId:null,inputHash:c.contextHash,resultHash:hashValue(c.applicability)});continue;}}
  const d=rows.find(r=>r.revision.requirementId===required.requirementId);if(!d||d.decision!=="ACCEPTED"||d.id===required.decisionId){blockers.push("Review and independently approve the current mapping or a current not-applicable decision for "+required.reference);continue;}
  let state=states.get(d.runId);if(!state){state=await coverageRunState(tx,ctx,d.run);states.set(d.runId,state);}if(!state.current){blockers.push(required.reference+": "+state.reason);continue;}
  proof.push({requirementId:required.requirementId,kind:"MAPPING",decisionId:d.id,runId:d.runId,inputHash:d.run.inputHash,resultHash:d.run.resultHash!});
 }
 return {proof:proof.sort((a,b)=>a.requirementId.localeCompare(b.requirementId)),blockers};
}
async function actionState(tx:Tx,ctx:AuthorizedContext,a:ChangeAction,cache?:MappingCache){const state=await resolutionMappings(tx,ctx,a,cache);let valid=true;
 if(a.submission){const s=submissionOf(a);try{await assertReviewedFiles(tx,ctx.organizationId,s.files);}catch(e){if(!(e instanceof IntelligenceError))throw e;state.blockers.push(e.message);valid=false;}if(hashValue(s.mappings)!==hashValue(state.proof)){state.blockers.push("Mapping decisions changed after this submission");valid=false;}}
 return {...state,current:valid&&!state.blockers.length};
}
async function responseState(tx:Tx,ctx:AuthorizedContext,row:ChangeResponse){
 const plan=planOf(row),source=await sourceState(tx,ctx,row.snapshotId),actions=await tx.changeAction.findMany({where:{...org(ctx),responseId:row.id},include:{task:{select:{id:true,assigneeId:true,ownerName:true,dueDate:true}},control:{select:{title:true}}},orderBy:{controlId:"asc"}}),blockers=[...source.blockers];
 if(source.snapshot.contentHash!==plan.source.contentHash||source.snapshot.version!==plan.source.version)blockers.push("The reviewed source context changed after the response was created");
 const views=[],cache:MappingCache=new Map();for(const a of actions){assertActionPlan(a,plan);const state=await actionState(tx,ctx,a,cache);if(a.status!=="ACCEPTED")blockers.push("An action still needs independent acceptance: "+a.control.title);if(!state.current)blockers.push(...state.blockers);views.push({...a,submission:a.submission?submissionOf(a):null,history:historySchema.parse(a.history),...state});}
 if(!actions.length||actions.length!==plan.groups.length)blockers.push("The saved action plan is incomplete");
 const deps=await dependencies(tx,ctx,plan.groups.map(g=>g.controlId),plan.evidenceIds,plan.dependencies);if(deps.exceeded)blockers.push("Dependency review limit exceeded");
 const evidence=await linkedEvidence(tx,ctx,plan.evidenceIds);if(evidence.length!==plan.evidenceIds.length)blockers.push("Some originally linked evidence is unavailable");
 const contextHash=hashValue({source:{id:source.snapshot.id,hash:source.snapshot.contentHash,version:source.snapshot.version},planHash:row.planHash,actions:views.map(a=>({id:a.id,status:a.status,version:a.version,submissionHash:a.submissionHash,proof:a.proof,current:a.current})),dependencies:deps.items,evidence,blockers:[...new Set(blockers)].sort()});
 return {plan,actions:views,dependencies:deps.items,linkedEvidence:evidence,blockers:[...new Set(blockers)],contextHash};
}
export async function changeWorkspace(ctx:AuthorizedContext){return transaction(ctx,async tx=>{const actor=await requireMember(tx,ctx);const [responses,sources,evidence]=await Promise.all([
 tx.changeResponse.findMany({where:{...org(ctx),...(!ADMIN.includes(actor.role)?{actions:{some:{task:{assigneeId:ctx.userId}}}}:{})},orderBy:{createdAt:"desc"},take:100,select:{id:true,title:true,status:true,version:true,createdAt:true,closedAt:true,_count:{select:{actions:true}}}}),
 tx.regulatorySnapshot.findMany({where:org(ctx),distinct:["sourceId"],orderBy:[{firstCapturedAt:"desc"},{id:"desc"}],take:50,select:{id:true,title:true,reviewStatus:true,lastCheckedAt:true}}),
 tx.evidence.findMany({where:{...org(ctx),scanStatus:"CLEAN",reviewStatus:"APPROVED"},orderBy:{createdAt:"desc"},take:100,select:{id:true,filename:true}})
 ]);return {responses,sources:ADMIN.includes(actor.role)?sources:[],evidence:WRITER.includes(actor.role)?evidence:[],admin:ADMIN.includes(actor.role),enabled:libraryEnabled()};});}
export async function changeResponseDetail(ctx:AuthorizedContext,id:string){return transaction(ctx,async tx=>{
 const actor=await requireMember(tx,ctx),admin=ADMIN.includes(actor.role);const row=await tx.changeResponse.findFirst({where:{id,...org(ctx),...(!admin?{actions:{some:{task:{assigneeId:ctx.userId}}}}:{})}});if(!row)throw new IntelligenceError("Change response not found",404);
 const state=await responseState(tx,ctx,row),actions=admin?state.actions:state.actions.filter(a=>a.task.assigneeId===ctx.userId),empty={policies:[],suppliers:[],audits:[]};
 return {...state,response:{id:row.id,title:row.title,status:row.status,version:row.version,createdAt:row.createdAt,closedAt:row.closedAt},actions,plan:admin?state.plan:{...state.plan,groups:state.plan.groups.filter(g=>actions.some(a=>a.controlId===g.controlId)),evidenceIds:[],evidence:[],dependencies:empty,replaces:[]},dependencies:admin?state.dependencies:empty,linkedEvidence:admin?state.linkedEvidence:[],contextHash:admin?state.contextHash:"",blockers:admin?state.blockers:actions.flatMap(a=>a.blockers),resolutionCurrent:row.status==="RESOLVED"&&!!row.resolution&&hashValue(row.resolution)===row.resolutionHash&&(row.resolution as {contextHash?:string}).contextHash===state.contextHash};
 });}
async function actionContext(tx:Tx,ctx:AuthorizedContext,id:string,admin=false){const actor=await requireMember(tx,ctx,admin?ADMIN:WRITER);const a=await tx.changeAction.findFirst({where:{id,...org(ctx)},include:{response:true,task:{select:{assigneeId:true}}}});if(!a||!ADMIN.includes(actor.role)&&a.task.assigneeId!==ctx.userId)throw new IntelligenceError("Change action not found",404);if(a.response.status!=="ACTIVE")throw new IntelligenceError("The response is already resolved; its decisions are preserved",409);assertActionPlan(a,planOf(a.response));const source=await sourceState(tx,ctx,a.response.snapshotId);if(source.blockers.length)throw new IntelligenceError(source.blockers[0],409);return a;}
async function canAccept(tx:Tx,ctx:AuthorizedContext,id:string,version:number){const a=await actionContext(tx,ctx,id,true);if(a.status!=="SUBMITTED"||a.version!==version)throw new IntelligenceError("Action changed; refresh",409);const s=submissionOf(a);if(a.submittedById===ctx.userId||s.files.some(f=>f.uploadedById===ctx.userId))throw new IntelligenceError("A different administrator from the submitter and file uploaders must review",403);const state=await actionState(tx,ctx,a);if(!state.current)throw new IntelligenceError(state.blockers[0],409);return {a,s};}
export async function changeResponseAction(ctx:AuthorizedContext,id:string,input:unknown,store?:EvidenceObjectStore){requireLibrary();const d=changeActionSchema.parse(input);
 if(d.action==="ACCEPT"){
  const pre=await transaction(ctx,tx=>canAccept(tx,ctx,id,d.version));await verifyReviewedBytes(ctx,pre.s.files,store);
  return transaction(ctx,async tx=>{requireLibrary();const {a}=await canAccept(tx,ctx,id,d.version);if(a.submissionHash!==pre.a.submissionHash)throw new IntelligenceError("Submission changed during retrieval",409);await tx.changeAction.update({where:{id},data:{status:"ACCEPTED",reviewerId:ctx.userId,reviewNotes:d.notes,reviewedAt:new Date(),version:{increment:1}}});await tx.obligation.update({where:{id:a.taskId},data:{status:"COMPLETE",completedAt:new Date(),completionException:false,completionRationale:"Independently accepted change-response evidence. This is not a legal compliance or control-effectiveness verdict."}});await tx.changeResponse.update({where:{id:a.responseId},data:{version:{increment:1}}});await event(tx,ctx,a.responseId,"action_accepted",{actionId:id,submissionHash:a.submissionHash});return {id};});
 }
 return transaction(ctx,async tx=>{requireLibrary();const a=await actionContext(tx,ctx,id,d.action!=="SUBMIT");if(a.version!==d.version)throw new IntelligenceError("Action changed; refresh",409);
  if(d.action==="RETURN"){
   if(!["SUBMITTED","ACCEPTED"].includes(a.status)||a.submittedById===ctx.userId)throw new IntelligenceError("Only an independent administrator can return a submission",409);
   await tx.changeAction.update({where:{id},data:{status:"RETURNED",reviewerId:ctx.userId,reviewNotes:d.notes,reviewedAt:new Date(),version:{increment:1}}});await tx.obligation.update({where:{id:a.taskId},data:{status:"IN_PROGRESS",completedAt:null,completionException:false,completionRationale:""}});
  }else if(d.action==="SUBMIT"){
   if(a.task.assigneeId!==ctx.userId||!["OPEN","RETURNED"].includes(a.status))throw new IntelligenceError("Only the current action owner can submit open work",403);
   const state=await resolutionMappings(tx,ctx,a);if(state.blockers.length)throw new IntelligenceError(state.blockers[0],409);const files=await reviewedFiles(tx,ctx.organizationId,d.evidenceIds),history=historySchema.parse(a.history);if(history.length>=CHANGE_LIMITS.history)throw new IntelligenceError("Submission history limit reached",429);
   const submission={notes:d.notes,files,mappings:state.proof,submittedAt:new Date().toISOString()};await tx.changeAction.update({where:{id},data:{status:"SUBMITTED",submission:j(submission),submissionHash:hashValue(submission),submittedById:ctx.userId,history:j(a.submission?[...history,{submission:submissionOf(a),reviewNotes:a.reviewNotes,reviewedAt:a.reviewedAt?.toISOString()||null}]:history),version:{increment:1}}});await tx.obligation.update({where:{id:a.taskId},data:{status:"IN_PROGRESS",completedAt:null,completionException:false,completionRationale:""}});
  }
  await tx.changeResponse.update({where:{id:a.responseId},data:{version:{increment:1}}});await event(tx,ctx,a.responseId,d.action.toLowerCase(),{actionId:id});return {id};
 });
}
async function closureContext(tx:Tx,ctx:AuthorizedContext,id:string,d:z.infer<typeof closeChangeSchema>){
 requireLibrary();await requireMember(tx,ctx,ADMIN);const row=await tx.changeResponse.findFirst({where:{id,...org(ctx)}});if(!row||row.status!=="ACTIVE"||row.version!==d.version)throw new IntelligenceError("Response changed; refresh",409);
 const state=await responseState(tx,ctx,row);if(state.blockers.length||state.contextHash!==d.contextHash)throw new IntelligenceError(state.blockers[0]||"The response context changed; review it again",409);
 if(state.actions.some(a=>a.submittedById===ctx.userId))throw new IntelligenceError("An administrator independent of all action submissions must close the response",403);
 const files=[...new Map(state.actions.flatMap(a=>submissionOf(a).files).map(f=>[f.id,f])).values()];if(files.length>50)throw new IntelligenceError("A response can close with at most 50 distinct evidence files",409);return {row,state,files};
}
export async function closeChangeResponse(ctx:AuthorizedContext,id:string,input:unknown,store?:EvidenceObjectStore){
 requireLibrary();const d=closeChangeSchema.parse(input),pre=await transaction(ctx,tx=>closureContext(tx,ctx,id,d));await verifyReviewedBytes(ctx,pre.files,store);
 return transaction(ctx,async tx=>{const {state}=await closureContext(tx,ctx,id,d);
 const resolution={contextHash:state.contextHash,dependencies:state.dependencies,linkedEvidence:state.linkedEvidence,notes:d.notes,dependenciesReviewed:true,reviewerId:ctx.userId,reviewedAt:new Date().toISOString()};await tx.changeResponse.update({where:{id},data:{status:"RESOLVED",resolution,resolutionHash:hashValue(resolution),closedById:ctx.userId,closedAt:new Date(),version:{increment:1}}});await event(tx,ctx,id,"resolved",{contextHash:state.contextHash});return {id};});
}
export async function exportChangeResponse(ctx:AuthorizedContext,id:string){return transaction(ctx,async tx=>{await requireMember(tx,ctx,ADMIN);const row=await tx.changeResponse.findFirst({where:{id,...org(ctx)}});if(!row||row.status!=="RESOLVED"||!row.resolution||hashValue(row.resolution)!==row.resolutionHash)throw new IntelligenceError("Reviewed response record unavailable",404);const state=await responseState(tx,ctx,row);await event(tx,ctx,id,"exported");return {format:"regpilot-change-response-v1",title:row.title,plan:state.plan,planHash:row.planHash,actions:state.actions.map(a=>({controlId:a.controlId,taskId:a.taskId,requirements:a.requirements,submission:a.submission,submissionHash:a.submissionHash,reviewerId:a.reviewerId,reviewNotes:a.reviewNotes,reviewedAt:a.reviewedAt})),resolution:row.resolution,resolutionHash:row.resolutionHash,currentAtExport:!(state.blockers.length)&&(row.resolution as {contextHash?:string}).contextHash===state.contextHash,currentBlockers:state.blockers,limitation:"Internal record of selected relationships and human-reviewed actions. Not a complete regulatory inventory, legal opinion, independent digital signature or proof of control effectiveness."};});}
