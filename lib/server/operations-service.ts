import {connectorProviderEnabled} from "./connector-flags";
import {db} from "./db";
import type {AuthorizedContext} from "./authorization";
import {requireMember} from "./workspace-member";
import {hashValue} from "../regulatory/intelligence";
import {getSourceImpact} from "./intelligence-service";
import {programmeConfigured,programmeAiEnabled} from "./programme-service";
import {signalChanges,observationCurrent,type Observation} from "../connectors/observation";
import {connectorsEnabled,microsoft365Enabled,googleWorkspaceEnabled,gitlabEnabled,cloudflareEnabled,companiesHouseEnabled,vercelEnabled,supabaseEnabled} from "./connector-service";
export async function operationsWorkspace(ctx:AuthorizedContext,importId?:string){
 const data=await db.$transaction(async tx=>{const actor=await requireMember(tx,ctx);const org=ctx.organizationId,today=new Date(new Date().toISOString().slice(0,10)+"T00:00:00Z"),week=new Date(today.getTime()+7*86400000);
  const [tasks,overdue,open,evidencePending,assessments,imports,controls,members,evidence,connectors,pausedWatches]=await Promise.all([
   tx.obligation.findMany({where:{organizationId:org,status:{not:"COMPLETE"}},orderBy:[{dueDate:"asc"},{id:"asc"}],take:100,select:{id:true,title:true,dueDate:true,status:true,ownerName:true,assigneeId:true,controlId:true,connectorId:true,originKey:true}}),
   tx.obligation.count({where:{organizationId:org,status:{not:"COMPLETE"},dueDate:{lt:today}}}),tx.obligation.count({where:{organizationId:org,status:{not:"COMPLETE"}}}),
   tx.evidence.count({where:{organizationId:org,scanStatus:"CLEAN",reviewStatus:{in:["DRAFT","PENDING_REVIEW"]}}}),
   tx.assuranceAssessment.findMany({where:{organizationId:org,status:"ACCEPTED",validUntil:{lte:week}},orderBy:{validUntil:"asc"},take:25,select:{id:true,obligationId:true,validUntil:true,obligation:{select:{title:true}}}}),
   tx.programmeImport.findMany({where:{organizationId:org},orderBy:{createdAt:"desc"},take:20,select:{id:true,status:true,method:true,version:true,createdById:true,createdAt:true}}),
   tx.managedControl.findMany({where:{organizationId:org},orderBy:[{nextReviewAt:"asc"},{id:"asc"}],take:101,include:{owner:{select:{id:true,email:true}},links:{select:{obligationId:true,rationale:true},take:20},_count:{select:{links:true,tasks:{where:{organizationId:org,status:{not:"COMPLETE"}}}}}}}),
   tx.membership.findMany({where:{organizationId:org},take:100,select:{role:true,user:{select:{id:true,email:true}}}}),
   tx.evidence.findMany({where:{organizationId:org,scanStatus:"CLEAN"},orderBy:{createdAt:"desc"},take:120,select:{id:true,filename:true,reviewStatus:true}}),
   tx.evidenceConnector.findMany({where:{organizationId:org},orderBy:{createdAt:"desc"},take:20,select:{id:true,controlId:true,provider:true,repository:true,branch:true,enabled:true,version:true,intervalHours:true,nextRunAt:true,leaseUntil:true,lastSuccessAt:true,failureCode:true,runs:{orderBy:[{capturedAt:"desc"},{id:"desc"}],take:5,select:{id:true,configVersion:true,result:true,resultHash:true,signalHash:true,capturedAt:true,outcome:true}}}}),
   tx.watchSchedule.count({where:{organizationId:org,OR:[{failureCode:{not:null}},{enabled:true,nextCheckAt:{lt:new Date(Date.now()-3600000)}}]}})
  ]);
  const [policyReading,vendorReviewsDue]=await Promise.all([
   tx.policyAssignment.count({where:{organizationId:org,userId:ctx.userId,status:"PENDING",revision:{status:"PUBLISHED",policy:{active:true}}}}),
   ["OWNER","ADMIN"].includes(actor.role)?tx.vendor.count({where:{organizationId:org,active:true,nextReviewAt:{lte:week}}}):Promise.resolve(null)
  ]);
  const selected=importId||imports[0]?.id;const proposal=selected?await tx.programmeImport.findFirst({where:{id:selected,organizationId:org}}):null;
  const result=proposal?.result&&hashValue(proposal.result)===proposal.resultHash?proposal.result:null;
  return {tasks,summary:{policyReading,vendorReviewsDue,open,overdue,evidencePending,monitoringAttention:pausedWatches},assessments,imports,proposal:proposal?{id:proposal.id,status:proposal.status,version:proposal.version,method:proposal.method,attempts:proposal.attempts,lastStartedAt:proposal.lastStartedAt,createdById:proposal.createdById,result,integrityValid:!!result,reviewNotes:proposal.reviewNotes,evidenceManifest:proposal.evidenceManifest}:null,controls:controls.slice(0,100),controlLimitReached:controls.length>100,members,evidence,connectors:connectors.map(({leaseUntil,runs,...c})=>({...c,checking:!!leaseUntil&&leaseUntil>new Date(),runs:runs.map(r=>({...r,result:hashValue(r.result)===r.resultHash?r.result:null,current:connectorProviderEnabled(c.provider)&&hashValue(r.result)===r.resultHash&&c.enabled&&!c.failureCode&&observationCurrent(r,c,runs[0]?.id===r.id)})),stale:!connectorProviderEnabled(c.provider)||!runs[0]||hashValue(runs[0].result)!==runs[0].resultHash||!observationCurrent(runs[0],c,true),changes:runs.length>1&&runs[0].configVersion===runs[1].configVersion&&runs.slice(0,2).every(r=>hashValue(r.result)===r.resultHash)?signalChanges(runs[0].result as unknown as Observation,runs[1].result as unknown as Observation):[],changedSincePrevious:runs.length>1&&runs[0].configVersion===runs[1].configVersion&&runs.slice(0,2).every(r=>hashValue(r.result)===r.resultHash)&&(runs[0].result as unknown as Observation).engine===(runs[1].result as unknown as Observation).engine&&runs[0].signalHash!==runs[1].signalHash})),taskLimitReached:open>tasks.length};
 },{isolationLevel:"RepeatableRead",timeout:12000});
 const impact=await getSourceImpact(ctx);
 return {...data,sourceImpact:impact,features:{programme:!!programmeConfigured(),ai:!!programmeAiEnabled(),connectors:connectorsEnabled(),microsoft365:microsoft365Enabled(),googleWorkspace:googleWorkspaceEnabled(),gitlab:gitlabEnabled(),cloudflare:cloudflareEnabled(),companiesHouse:companiesHouseEnabled(),vercel:vercelEnabled(),supabase:supabaseEnabled(),automation:process.env.REGPILOT_AUTOMATION_ENABLED==="true"},generatedAt:new Date().toISOString()};
}
