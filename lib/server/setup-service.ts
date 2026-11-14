import {z} from 'zod';
import {db} from './db';
import {transaction,IntelligenceError} from './intelligence-service';
import {requireMember,ADMIN} from './workspace-member';
import {ACTIVITIES,JURISDICTIONS,hashValue,parseProfile} from '../regulatory/intelligence';
import {planSourcePortfolio} from './watch-portfolio';
import {REGULATORY_SOURCES} from '../regulatory-sources.mjs';
import {allowedEmail} from '../ai/security.mjs';
import {workspaceCatalogue} from './publication-catalogue';
import {sourceCoverage} from './source-coverage';
import {getConnectorHealth} from './connector-health-service';
import {evidenceConfigured} from './evidence-storage';
import {connectorProviderEnabled} from './connector-flags';
import {recommendSourcePortfolio} from '../regulatory/portfolio-recommendations.mjs';
import type {AuthorizedContext} from './authorization';

export const setupInput=z.object({
 profileVersion:z.number().int().nonnegative(),activities:z.array(z.enum(ACTIVITIES)).min(1).max(ACTIVITIES.length),
 jurisdictions:z.array(z.enum(JURISDICTIONS)).min(1).max(4),
 sources:z.array(z.object({sourceId:z.string().min(3).max(120),version:z.number().int().nonnegative()}).strict()).min(1).max(30),
 intervalHours:z.union([z.literal(24),z.literal(168)]),reviewAcknowledged:z.literal(true)
}).strict();
export async function getSetupWorkspace(ctx:AuthorizedContext){
 const summary=await db.$transaction(async tx=>{
  const actor=await requireMember(tx,ctx),organizationId=ctx.organizationId;
  const [profile,watches,members,evidence,controls,tasks]=await Promise.all([
   tx.businessProfile.findUnique({where:{organizationId},select:{activities:true,jurisdictions:true,version:true}}),
   tx.watchSchedule.findMany({where:{organizationId},select:{sourceId:true,version:true,enabled:true,intervalHours:true}}),
   tx.membership.findMany({where:{organizationId,role:{in:['OWNER','ADMIN']}},select:{user:{select:{email:true}}}}),
   tx.evidence.groupBy({by:['scanStatus','reviewStatus'],where:{organizationId},_count:true}),
   tx.managedControl.count({where:{organizationId,enabled:true}}),
   tx.obligation.count({where:{organizationId,status:{not:'COMPLETE'}}})
  ]);
  return {role:actor.role,profile:profile?{...parseProfile(profile),version:profile.version}:null,watches,independentReviewers:members.filter(m=>allowedEmail(m.user.email,process.env.REGPILOT_AI_ALLOWED_EMAILS)).length,
   evidence:{total:evidence.reduce((n,r)=>n+r._count,0),approved:evidence.filter(r=>r.scanStatus==='CLEAN'&&r.reviewStatus==='APPROVED').reduce((n,r)=>n+r._count,0)},controls,openTasks:tasks};
 },{isolationLevel:'RepeatableRead',timeout:12000});
 const [catalogue,coverage,connections]=await Promise.all([workspaceCatalogue(ctx),sourceCoverage(ctx),getConnectorHealth(ctx)]);
 return {...summary,catalogue,coverage,connections,recommendations:recommendSourcePortfolio(catalogue,summary.profile),
  features:{monitoring:process.env.REGPILOT_MONITORING_ENABLED==='true'&&process.env.REGPILOT_AUTOMATION_ENABLED==='true'&&process.env.REGPILOT_CRON_ENABLED==='true',evidence:!!evidenceConfigured(),
   providers:['GITHUB','MICROSOFT365','GOOGLE_WORKSPACE','GITLAB','CLOUDFLARE','COMPANIES_HOUSE','VERCEL','SUPABASE'].map(id=>({id,configured:connectorProviderEnabled(id)}))},generatedAt:new Date().toISOString()};
}
// Profile and schedules are one reviewed, version-checked transaction. No provider calls or activation.
export async function saveSetupWorkspace(ctx:AuthorizedContext,input:unknown){
 const d=setupInput.parse(input),profile=parseProfile(d);
 if(new Set(d.sources.map(s=>s.sourceId)).size!==d.sources.length)throw new IntelligenceError('Select each publication once');
 return transaction(ctx,async tx=>{
  await requireMember(tx,ctx,ADMIN);
  const organizationId=ctx.organizationId;
  const [old,registered,watches]=await Promise.all([
   tx.businessProfile.findUnique({where:{organizationId}}),
   tx.registeredSource.findMany({where:{organizationId},select:{sourceId:true},take:201}),
   tx.watchSchedule.findMany({where:{organizationId}})
  ]);
  if((old?.version||0)!==d.profileVersion)throw new IntelligenceError('Your business profile changed. Refresh setup before saving.',409);
  const plan=planSourcePortfolio({sourceIds:d.sources.map(s=>s.sourceId),enabled:true,intervalHours:d.intervalHours},[...REGULATORY_SOURCES.map(s=>s.id),...registered.map(s=>s.sourceId)]);
  const byId=new Map(watches.map(w=>[w.sourceId,w]));
  for(const selected of d.sources)if((byId.get(selected.sourceId)?.version||0)!==selected.version)throw new IntelligenceError('A monitoring schedule changed. Refresh setup before saving.',409);
  if(watches.length+plan.sourceIds.filter(id=>!byId.has(id)).length>120)throw new IntelligenceError('Maximum 120 monitored publications per organisation',429);
  const profileChanged=!old||hashValue(parseProfile(old))!==hashValue(profile);
  const saved=profileChanged?await tx.businessProfile.upsert({where:{organizationId},create:{organizationId,...profile,updatedById:ctx.userId},update:{...profile,updatedById:ctx.userId,version:{increment:1}}}):old;
  let created=0,updated=0,unchanged=0;
  for(const sourceId of plan.sourceIds){
   const prior=byId.get(sourceId);
   if(prior?.enabled&&prior.intervalHours===d.intervalHours&&!prior.failureCode){unchanged++;continue;}
   const data={enabled:true,intervalHours:d.intervalHours,configuredById:ctx.userId,nextCheckAt:new Date(),leaseUntil:null,leaseToken:null,attempts:0,failureCode:null};
   if(prior){await tx.watchSchedule.update({where:{id:prior.id},data:{...data,version:{increment:1}}});updated++;}
   else{await tx.watchSchedule.create({data:{organizationId,sourceId,...data}});created++;}
  }
  await tx.auditEvent.create({data:{organizationId,actorId:ctx.userId,action:'workspace.setup_saved',entityType:'Organization',entityId:organizationId,
   details:{profileVersion:saved!.version,profileChanged,sourceIds:plan.sourceIds,intervalHours:d.intervalHours,created,updated,unchanged}}});
  return {profileVersion:saved!.version,created,updated,unchanged,selected:plan.sourceIds.length};
 });
}
