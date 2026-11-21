import {Prisma,type AssuranceAssessment} from '@prisma/client';
import {db} from './db';
import type {AuthorizedContext} from './authorization';
import {requireMember,ADMIN,WRITER} from './workspace-member';
import {IntelligenceError} from './intelligence-service';
import {currentAssessment} from './assurance-service';
import {allowedEmail} from '../ai/security.mjs';
import {EVIDENCE_LIBRARY_PAGE_SIZE,EVIDENCE_LIBRARY_USE_LIMIT,type EvidenceLibraryQuery} from '../evidence-library.mjs';

type Tx=Prisma.TransactionClient;
const select={id:true,filename:true,contentType:true,sizeBytes:true,sha256:true,scanStatus:true,reviewStatus:true,reviewVersion:true,createdAt:true,reviewedAt:true,uploadedById:true,reviewerId:true,
 uploadedBy:{select:{email:true}},reviewer:{select:{email:true}},obligation:{select:{id:true,title:true,status:true}}} satisfies Prisma.EvidenceSelect;
type FileRow=Prisma.EvidenceGetPayload<{select:typeof select}>;
function href(path:string,organizationId:string,values:Record<string,string>={}){const params=new URLSearchParams({organizationId,...values});return path+'?'+params.toString();}
// Prisma contains uses SQL LIKE. Escape its wildcards so the customer searches literal filenames/titles.
const literal=(value:string)=>value.replace(/[\\%_]/g,'\\$&');
function view(row:FileRow,ctx:AuthorizedContext,role:string){
 const canPrepare=WRITER.includes(role),canReuse=canPrepare&&row.scanStatus==='CLEAN';
 return {id:row.id,filename:row.filename,contentType:row.contentType,sizeBytes:row.sizeBytes,sha256:row.sha256,scanStatus:row.scanStatus,reviewStatus:row.reviewStatus,reviewVersion:row.reviewVersion,createdAt:row.createdAt,reviewedAt:row.reviewedAt,uploadedById:row.uploadedById,reviewerId:row.reviewerId,uploaderName:row.uploadedBy?.email||'Uploader unavailable',reviewerName:row.reviewer?.email||null,
  originalTask:{...row.obligation,href:href('/team/work',ctx.organizationId,{taskId:row.obligation.id})},taskEvidenceHref:href('/team/evidence',ctx.organizationId,{taskId:row.obligation.id}),
  canReview:ADMIN.includes(role)&&row.scanStatus==='CLEAN'&&row.reviewStatus==='PENDING_REVIEW'&&!!row.uploadedById&&row.uploadedById!==ctx.userId,
  canReuse,reuseReason:!canPrepare?'An editor or administrator can prepare an evidence assessment.':row.scanStatus!=='CLEAN'?'This file is quarantined and cannot be used.':row.reviewStatus!=='APPROVED'?'You can prepare an assessment. Independent file review is still required before an accepted task outcome.':'Check the file against the new task. Its existing file approval does not approve a different use.'};
}
function criteria(ctx:AuthorizedContext,query:EvidenceLibraryQuery):Prisma.EvidenceWhereInput{
 const where:Prisma.EvidenceWhereInput={organizationId:ctx.organizationId,obligation:{organizationId:ctx.organizationId}};
 if(query.review==='quarantined')where.scanStatus={not:'CLEAN'};
 else if(query.review!=='all'){where.scanStatus='CLEAN';where.reviewStatus=query.review==='approved'?'APPROVED':query.review==='rejected'?'REJECTED':{in:['DRAFT','PENDING_REVIEW']};}
 if(query.format!=='all')where.contentType=query.format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
 if(query.uploader==='mine')where.uploadedById=ctx.userId;
 if(query.q){const contains=literal(query.q);where.OR=[{filename:{contains,mode:'insensitive'}},{obligation:{title:{contains,mode:'insensitive'},organizationId:ctx.organizationId}}];}
 return where;
}
async function participantState(tx:Tx,org:string,row:AssuranceAssessment){
 // currentAssessment verifies source/content fingerprints. The library must also avoid presenting
 // an accepted record as current after one of its independent participants loses eligibility.
 const files=await tx.evidence.findMany({where:{organizationId:org,id:{in:(row.evidenceManifest as Array<{id:string}>).map(file=>file.id)}},select:{uploadedById:true,reviewerId:true}});
 const source=await tx.regulatorySnapshot.findFirst({where:{id:row.snapshotId,organizationId:org},select:{capturedById:true,reviewerId:true}});
 if(!source?.capturedById||!source.reviewerId||source.capturedById===source.reviewerId)return false;
 const participants=[{id:row.createdById,roles:WRITER},...(row.status==='ACCEPTED'?[{id:row.reviewerId,roles:ADMIN}]:[]),{id:source?.capturedById,roles:WRITER},{id:source?.reviewerId,roles:ADMIN},...files.flatMap(file=>[{id:file.uploadedById,roles:WRITER},{id:file.reviewerId,roles:ADMIN}])];
 const ids=[...new Set(participants.flatMap(p=>p.id?[p.id]:[]))];
 const members=await tx.membership.findMany({where:{organizationId:org,userId:{in:ids}},select:{userId:true,role:true,user:{select:{email:true}}}});
 return participants.every(p=>p.id&&members.some(m=>m.userId===p.id&&p.roles.includes(m.role)&&allowedEmail(m.user.email,process.env.REGPILOT_AI_ALLOWED_EMAILS)));
}
async function uses(tx:Tx,ctx:AuthorizedContext,evidenceId:string){
 const where:Prisma.AssuranceAssessmentWhereInput={organizationId:ctx.organizationId,obligation:{organizationId:ctx.organizationId},evidenceManifest:{array_contains:[{id:evidenceId}]}};
 const [total,rows]=await Promise.all([tx.assuranceAssessment.count({where}),tx.assuranceAssessment.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],take:EVIDENCE_LIBRARY_USE_LIMIT,include:{obligation:{select:{title:true}}}})]);
 const items=[];
 for(const row of rows){
  let current=false,reason='This assessment has not completed or its retained content is unavailable.';
  if(['DRAFT','ACCEPTED','NEEDS_WORK'].includes(row.status)){
   const state=await currentAssessment(tx,ctx.organizationId,row);current=state.valid;reason=state.reason||'Saved source, business context and reviewed file metadata still match.';
   if(current&&!await participantState(tx,ctx.organizationId,row)){current=false;reason='An author, uploader or independent reviewer no longer has the required workspace access.';}
  }
  items.push({id:row.id,taskId:row.obligationId,title:row.obligation.title,status:row.status,current,reason,href:href('/team/assurance',ctx.organizationId,{taskId:row.obligationId,assessmentId:row.id})});
 }
 return {scope:'source-linked assessments' as const,items,total,truncated:total>items.length};
}
async function targets(tx:Tx,ctx:AuthorizedContext,query:EvidenceLibraryQuery,file:ReturnType<typeof view>){
 const empty={items:[] as Array<{id:string;title:string;status:string;ownerName:string;href:string}>,total:0,page:1,pages:1,pageSize:EVIDENCE_LIBRARY_PAGE_SIZE};
 if(!file.canReuse)return empty;
 const where:Prisma.ObligationWhereInput={organizationId:ctx.organizationId,status:{not:'COMPLETE'},originKey:{not:null},intelligenceDecisions:{some:{organizationId:ctx.organizationId,decision:'ACCEPTED'}}};
 if(query.targetQ){const contains=literal(query.targetQ);where.OR=[{title:{contains,mode:'insensitive'}},{category:{contains,mode:'insensitive'}},{ownerName:{contains,mode:'insensitive'}}];}
 const total=await tx.obligation.count({where}),pages=Math.max(1,Math.ceil(total/EVIDENCE_LIBRARY_PAGE_SIZE)),page=Math.min(query.targetPage,pages);
 const rows=await tx.obligation.findMany({where,orderBy:[{dueDate:'asc'},{id:'asc'}],skip:(page-1)*EVIDENCE_LIBRARY_PAGE_SIZE,take:EVIDENCE_LIBRARY_PAGE_SIZE,select:{id:true,title:true,status:true,ownerName:true}});
 return {items:rows.map(row=>({...row,href:href('/team/assurance',ctx.organizationId,{taskId:row.id,evidenceId:file.id})})),total,page,pages,pageSize:EVIDENCE_LIBRARY_PAGE_SIZE};
}
/** Read-only, tenant-bound inventory. Original bytes are read only by existing explicit download/assessment actions. */
export async function evidenceLibrary(ctx:AuthorizedContext,query:EvidenceLibraryQuery){
 const result=await db.$transaction(async tx=>{
  const actor=await requireMember(tx,ctx),base:Prisma.EvidenceWhereInput={organizationId:ctx.organizationId,obligation:{organizationId:ctx.organizationId}},where=criteria(ctx,query);
  const [total,groups,mine]=await Promise.all([tx.evidence.count({where}),tx.evidence.groupBy({by:['reviewStatus','scanStatus'],where:base,_count:{_all:true}}),tx.evidence.count({where:{...base,uploadedById:ctx.userId}})]);
  const summary={all:0,approved:0,pending:0,rejected:0,quarantined:0,mine};
  for(const group of groups){const count=group._count._all;summary.all+=count;if(group.scanStatus!=='CLEAN')summary.quarantined+=count;else if(group.reviewStatus==='APPROVED')summary.approved+=count;else if(group.reviewStatus==='REJECTED')summary.rejected+=count;else summary.pending+=count;}
  const pages=Math.max(1,Math.ceil(total/EVIDENCE_LIBRARY_PAGE_SIZE)),page=Math.min(query.page,pages);
  const rows=await tx.evidence.findMany({where,select,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(page-1)*EVIDENCE_LIBRARY_PAGE_SIZE,take:EVIDENCE_LIBRARY_PAGE_SIZE});
  let selected:null|(ReturnType<typeof view>&{uses:Awaited<ReturnType<typeof uses>>;targets:Awaited<ReturnType<typeof targets>>})=null;
  if(query.evidenceId){
   const row=await tx.evidence.findFirst({where:{...base,id:query.evidenceId},select});if(!row)throw new IntelligenceError('Evidence not found in this company',404);
   const file=view(row,ctx,actor.role);const [recordedUses,reuseTargets]=await Promise.all([uses(tx,ctx,row.id),targets(tx,ctx,query,file)]);selected={...file,uses:recordedUses,targets:reuseTargets};
  }
  return {organizationId:ctx.organizationId,role:actor.role,canPrepare:WRITER.includes(actor.role),items:rows.map(row=>view(row,ctx,actor.role)),total,page,pages,pageSize:EVIDENCE_LIBRARY_PAGE_SIZE,summary,selected,generatedAt:new Date().toISOString()};
 },{isolationLevel:'RepeatableRead',maxWait:5000,timeout:12000});
 // Recheck in a new transaction: a repeatable-read snapshot cannot observe access removal
 // that commits while the inventory is being assembled.
 const latest=await db.$transaction(tx=>requireMember(tx,ctx));
 if(latest.role!==result.role)throw new IntelligenceError('Your workspace access changed. Refresh the evidence library.',409);
 return result;
}
