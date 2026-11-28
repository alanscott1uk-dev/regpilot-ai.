import {Prisma} from '@prisma/client';
import type {AuthorizedContext} from './authorization';
import {allowedEmail} from '../ai/security.mjs';
import {parseProfile} from '../regulatory/intelligence';
import {ADMIN,WRITER} from './workspace-member';
import {verifiedCompletionEvent,type CompletionReceipt} from './work-completion-service';
import {monitoringRuntimeActive} from './monitoring-runtime-status';

export const JOURNEY_COMPLETION_LIMIT=200;
export type JourneyStep={key:'scope'|'sources'|'work'|'evidence'|'completion'|'report';title:string;status:'NOT_STARTED'|'ACTION_NEEDED'|'RECORDED'|'BLOCKED'|'AVAILABLE';detail:string;href:string;actionLabel:string};
export type CompletedWorkRecord={taskId:string;title:string;owner:string;completedAt:string;eventId:string;proofHash:string;evidenceCount:number;href:string;receipt:CompletionReceipt};
export function workspaceLink(organizationId:string,path:string,extra:Record<string,string>={}){return path+'?'+new URLSearchParams({organizationId,...extra});}

/** Frozen completion history only. It does not re-check current evidence or retrieve file bytes. */
export async function recordedWorkCompletions(tx:Prisma.TransactionClient,ctx:AuthorizedContext,since?:Date,until=new Date()){
 const rows=await tx.$queryRaw<Array<{id:string;entityId:string;actorId:string;action:string;details:Prisma.JsonValue;completedAt:Date}>>(Prisma.sql`
  SELECT latest.id,latest."entityId",latest."actorId",latest.action,latest.details,o."completedAt"
  FROM (
   SELECT DISTINCT ON ("entityId") id,"entityId","actorId",action,details,"createdAt"
   FROM "AuditEvent" WHERE "organizationId"=${ctx.organizationId}::uuid AND action='work.completed' AND "entityType"='Obligation'
   ORDER BY "entityId","createdAt" DESC,id DESC
  ) latest
  JOIN "Obligation" o ON o.id::text=latest."entityId" AND o."organizationId"=${ctx.organizationId}::uuid
  WHERE o.status='COMPLETE' AND o."completedAt" IS NOT NULL AND o."completedAt"<=${until}
  ${since?Prisma.sql`AND o."completedAt">=${since}`:Prisma.empty}
  ORDER BY o."completedAt" DESC,o.id DESC LIMIT ${JOURNEY_COMPLETION_LIMIT+1}`);
 const records:CompletedWorkRecord[]=[];
 let unavailable=0;
 for(const row of rows.slice(0,JOURNEY_COMPLETION_LIMIT)){
  const saved=verifiedCompletionEvent(ctx,row.entityId,row);
  if(!saved||saved.receipt.completedAt!==row.completedAt.toISOString()){unavailable++;continue;}
  const receipt=saved.receipt;
  records.push({taskId:receipt.task.id,title:receipt.task.title,owner:receipt.task.ownerName,completedAt:receipt.completedAt,eventId:saved.eventId,proofHash:saved.proofHash,evidenceCount:receipt.evidence.length,href:workspaceLink(ctx.organizationId,'/team/work',{taskId:receipt.task.id}),receipt});
 }
 return {records,limited:rows.length>JOURNEY_COMPLETION_LIMIT,unavailable};
}

/** This projection runs inside the caller's authorised read transaction; it never writes progress. */
export async function workspaceJourney(tx:Prisma.TransactionClient,ctx:AuthorizedContext,now=new Date()){
 const organizationId=ctx.organizationId,href=(path:string,extra:Record<string,string>={})=>workspaceLink(organizationId,path,extra);
 const [profile,members,selectedSources,watches,totalTasks,openTasks,completedTasks,completionExceptions,cleanFiles,pendingFiles,completions]=await Promise.all([
  tx.businessProfile.findUnique({where:{organizationId},select:{activities:true,jurisdictions:true,version:true}}),
  tx.membership.findMany({where:{organizationId},orderBy:{userId:'asc'},take:101,select:{role:true,user:{select:{id:true,email:true}}}}),
  tx.watchSchedule.count({where:{organizationId,enabled:true}}),
  tx.watchSchedule.findMany({where:{organizationId,enabled:true},orderBy:{sourceId:'asc'},take:120,select:{sourceId:true,nextCheckAt:true,lastSuccessAt:true,failureCode:true}}),
  tx.obligation.count({where:{organizationId}}),
  tx.obligation.count({where:{organizationId,status:{not:'COMPLETE'}}}),
  tx.obligation.count({where:{organizationId,status:'COMPLETE'}}),
  tx.obligation.count({where:{organizationId,status:'COMPLETE',completionException:true}}),
  tx.evidence.count({where:{organizationId,scanStatus:'CLEAN'}}),
  tx.evidence.count({where:{organizationId,scanStatus:'CLEAN',reviewStatus:{in:['DRAFT','PENDING_REVIEW']}}}),
  recordedWorkCompletions(tx,ctx,undefined,now)
 ]);
 const membershipLimited=members.length>100,eligible=membershipLimited?[]:members.filter(m=>allowedEmail(m.user.email,process.env.REGPILOT_AI_ALLOWED_EMAILS));
 const writers=eligible.filter(m=>WRITER.includes(m.role)).map(m=>m.user.id),reviewers=eligible.filter(m=>ADMIN.includes(m.role)).map(m=>m.user.id);
 const eligibleOtherReviewers=reviewers.filter(id=>id!==ctx.userId).length,hasReviewPair=reviewers.some(reviewer=>writers.some(writer=>writer!==reviewer));
 const [assignedOpenTasks,approved,snapshots]=await Promise.all([
  writers.length?tx.obligation.count({where:{organizationId,status:{not:'COMPLETE'},assigneeId:{in:writers}}}):Promise.resolve(0),
  writers.length&&reviewers.length?tx.$queryRaw<Array<{count:number}>>(Prisma.sql`
   SELECT COUNT(*)::integer AS count FROM "Evidence" WHERE "organizationId"=${organizationId}::uuid
   AND "scanStatus"='CLEAN' AND "reviewStatus"='APPROVED' AND "reviewedAt" IS NOT NULL AND "scannedAt" IS NOT NULL
   AND "uploadedById"<>"reviewerId" AND sha256~'^[a-f0-9]{64}$'
   AND "uploadedById" IN (${Prisma.join(writers.map(id=>Prisma.sql`${id}::uuid`))})
   AND "reviewerId" IN (${Prisma.join(reviewers.map(id=>Prisma.sql`${id}::uuid`))})`):Promise.resolve([{count:0}]),
  watches.length?tx.$queryRaw<Array<{sourceId:string;id:string;reviewStatus:string;lastCheckedAt:Date;reviewedAt:Date|null;reviewerId:string|null;capturedById:string}>>(Prisma.sql`
   SELECT DISTINCT ON ("sourceId") "sourceId",id,"reviewStatus"::text,"lastCheckedAt","reviewedAt","reviewerId","capturedById"
   FROM "RegulatorySnapshot" WHERE "organizationId"=${organizationId}::uuid AND "sourceId" IN (${Prisma.join(watches.map(w=>w.sourceId))})
   ORDER BY "sourceId","firstCapturedAt" DESC,id DESC`):Promise.resolve([])
 ]);
 let hasProfile=false;
 try{const value=parseProfile(profile);hasProfile=!!value.activities.length&&!!value.jurisdictions.length;}catch{/* Invalid profile is an incomplete milestone, never a healthy default. */}
 const independentlyApprovedFiles=approved[0]?.count||0,monitoringActive=monitoringRuntimeActive();
 const pendingSources=snapshots.filter(s=>s.reviewStatus==='NEEDS_REVIEW'||!s.reviewedAt||!s.reviewerId||s.reviewerId===s.capturedById||!reviewers.includes(s.reviewerId)||!writers.includes(s.capturedById));
 const latestSourcesAwaitingReview=pendingSources.length;
 const stale=snapshots.filter(s=>s.lastCheckedAt.getTime()<now.getTime()-7*86400000||s.lastCheckedAt>now),staleSources=stale.length;
 const nextSource=pendingSources[0]?.sourceId||watches.find(w=>!snapshots.some(s=>s.sourceId===w.sourceId))?.sourceId||stale[0]?.sourceId||watches.find(w=>w.failureCode||!w.lastSuccessAt)?.sourceId||watches[0]?.sourceId;
 const sourceFailures=watches.filter(w=>!!w.failureCode||w.nextCheckAt.getTime()<now.getTime()-3600000).length;
 const uncheckedSources=watches.filter(w=>!w.lastSuccessAt).length;
 const unassignedOpenTasks=openTasks-assignedOpenTasks;
 const sourceRecordsLimited=selectedSources>watches.length;
 const steps:JourneyStep[]=[
  {key:'scope',title:'Business scope',status:hasProfile?'RECORDED':'NOT_STARTED',detail:hasProfile?'Your business activities and UK nations are saved. Review them when the business changes.':'Choose the business activities and UK nations to use when reviewing requirements.',href:href('/team/setup'),actionLabel:hasProfile?'Review business scope':'Set up your business'},
  {key:'sources',title:'Regulatory updates',status:!selectedSources?'NOT_STARTED':sourceRecordsLimited?'BLOCKED':snapshots.length<selectedSources||latestSourcesAwaitingReview||staleSources||sourceFailures?'ACTION_NEEDED':!monitoringActive||uncheckedSources?'BLOCKED':'RECORDED',
   detail:!selectedSources?'Select the official publications you want to monitor.':`${snapshots.length} of ${selectedSources} selected publications have a saved capture; ${latestSourcesAwaitingReview} latest versions await review.${staleSources?' '+staleSources+' need a fresh capture.':''}${sourceFailures?' '+sourceFailures+' schedules need attention.':''}${!monitoringActive?' Background monitoring awaits activation.':uncheckedSources?' '+uncheckedSources+' await a first scheduled check.':''}`,
   href:href(!selectedSources?'/team/setup':sourceRecordsLimited?'/team/coverage':'/team/sources',selectedSources&&!sourceRecordsLimited&&nextSource?{sourceId:nextSource}:{}),actionLabel:!selectedSources?'Choose publications':latestSourcesAwaitingReview?'Review saved publications':'Inspect source monitoring'},
  {key:'work',title:'Owned work',status:membershipLimited?'BLOCKED':!totalTasks?'NOT_STARTED':unassignedOpenTasks?'ACTION_NEEDED':'RECORDED',detail:membershipLimited?'The membership review limit was reached. Task ownership cannot be verified until team access is reconciled.':!totalTasks?'Review what applies and create a task with a responsible team member and target date.':`${assignedOpenTasks} open tasks have an eligible assigned member; ${unassignedOpenTasks} still need an eligible assignee.`,href:href(membershipLimited?'/team/settings':'/team/work'),actionLabel:membershipLimited?'Review team access':!totalTasks?'Create your first task':unassignedOpenTasks?'Assign outstanding work':'Open team work'},
  {key:'evidence',title:'Reviewed evidence',status:membershipLimited?'BLOCKED':pendingFiles?'ACTION_NEEDED':independentlyApprovedFiles?'RECORDED':!hasReviewPair?'BLOCKED':!cleanFiles?'NOT_STARTED':'ACTION_NEEDED',
   detail:membershipLimited?'The membership review limit was reached. Reconcile team access before relying on approval counts.':`${independentlyApprovedFiles} files have independent approval by currently eligible members; ${pendingFiles} clean files await review.${!hasReviewPair?' An uploader and a different eligible administrator are required.':''} Approval metadata is shown; file bytes are checked during completion and download.`,href:href(!hasReviewPair?'/team/settings':'/team/evidence'),actionLabel:!hasReviewPair?'Set up independent review':pendingFiles?'Review supporting files':!cleanFiles?'Add supporting evidence':'Open reviewed evidence'},
  {key:'completion',title:'Recorded outcomes',status:completions.records.length?'RECORDED':totalTasks?'ACTION_NEEDED':'NOT_STARTED',detail:`${completions.records.length} validated completion records${completions.limited?' in the latest '+JOURNEY_COMPLETION_LIMIT+' reviewed records':''}; ${completionExceptions} documented exceptions.${completions.unavailable?' '+completions.unavailable+' sampled completion records are unavailable.':''} Saved decisions describe the evidence at completion, not continuing compliance.`,href:href(completions.records.length?'/team/work/reviews':'/team/work'),actionLabel:completions.records.length?'Review recorded outcomes':'Complete supported work'},
  {key:'report',title:'Review report',status:'AVAILABLE',detail:'Open the seven-day operational report, including gaps and saved completion records. Downloading a report does not approve the underlying work.',href:href('/team/briefing'),actionLabel:'Open review report'}
 ];
 const next=steps.find(s=>s.status==='NOT_STARTED'||s.status==='ACTION_NEEDED')||steps.find(s=>s.status==='BLOCKED')||steps[5];
 return {organizationId,generatedAt:now.toISOString(),steps,nextAction:{key:next.key,title:next.title,detail:next.detail,href:next.href,label:next.actionLabel},
  facts:{profileVersion:profile?.version||null,selectedSources,latestCapturedSources:snapshots.length,latestSourcesAwaitingReview,sourceFailures,monitoringActive,eligibleOtherReviewers,totalTasks,assignedOpenTasks,unassignedOpenTasks,cleanFiles,pendingFiles,independentlyApprovedFiles,completedTasks,completionExceptions,recordedCompletions:completions.records.length},
  limits:{membershipLimited,sourceRecordsLimited,completionRecordsLimited:completions.limited},notice:'This is a map of saved work and outstanding actions. It is not a compliance score, a complete regulatory inventory or an audit opinion.'};
}
