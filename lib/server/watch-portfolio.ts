import {z} from "zod";
import {db} from "./db";
import {REGULATORY_SOURCES} from "../regulatory-sources.mjs";
import {requireMember,ADMIN} from "./workspace-member";
import {IntelligenceError} from "./intelligence-service";
import type {AuthorizedContext} from "./authorization";

/** Admin-selected portfolios are a monitoring convenience, NEVER an applicability assessment. */
export const portfolioInput = z.object({
 sourceIds:z.array(z.string().min(3).max(120)).min(1).max(30),
 enabled:z.boolean(),intervalHours:z.union([z.literal(24),z.literal(168)])
}).strict();

export function planSourcePortfolio(input:unknown, permitted:readonly string[]) {
 const parsed=portfolioInput.safeParse(input);
 if(!parsed.success)throw new IntelligenceError("Choose up to 30 distinct sources and a daily or weekly interval");
 const {sourceIds,enabled,intervalHours}=parsed.data;
 if(new Set(sourceIds).size!==sourceIds.length)throw new IntelligenceError("Remove duplicate source identifiers");
 const allowed=new Set(permitted);
 if(sourceIds.some(id=>!allowed.has(id)))throw new IntelligenceError("Unknown or unregistered publication identifier");
 return {sourceIds,enabled,intervalHours};
}
export async function configureWatchPortfolio(ctx:AuthorizedContext,input:unknown){
 if(!["OWNER","ADMIN"].includes(ctx.role))throw new IntelligenceError("Administrator required",403);
 return db.$transaction(async tx=>{
  await requireMember(tx,ctx,ADMIN);
  const registered=await tx.registeredSource.findMany({where:{organizationId:ctx.organizationId},select:{sourceId:true},take:201});
  const allowed=[...REGULATORY_SOURCES.map(x=>x.id),...registered.map(x=>x.sourceId)];
  const plan=planSourcePortfolio(input,allowed);
  const existing=await tx.watchSchedule.findMany({where:{organizationId:ctx.organizationId,sourceId:{in:plan.sourceIds}}});
  const byId=new Map(existing.map(x=>[x.sourceId,x]));
  const existingTotal=await tx.watchSchedule.count({where:{organizationId:ctx.organizationId}});
  if(existingTotal+plan.sourceIds.filter(id=>!byId.has(id)).length>120)throw new IntelligenceError("Maximum 120 monitored publications per organisation",429);
  let created=0,updated=0,unchanged=0;
  for(const sourceId of plan.sourceIds){
   const old=byId.get(sourceId);
   if(old?.enabled===plan.enabled&&old.intervalHours===plan.intervalHours&&!old.failureCode){unchanged++;continue;}
   const data={enabled:plan.enabled,intervalHours:plan.intervalHours,configuredById:ctx.userId,nextCheckAt:new Date(),
    leaseToken:null,leaseUntil:null,attempts:0,failureCode:null};
   if(old){
    await tx.watchSchedule.update({where:{id:old.id},data:{...data,version:{increment:1}}});updated++;
   }else{
    await tx.watchSchedule.create({data:{organizationId:ctx.organizationId,sourceId,...data}});created++;
   }
  }
  await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"monitoring.portfolio_configured",
   entityType:"Organization",entityId:ctx.organizationId,details:{sources:plan.sourceIds,created,updated,unchanged,intervalHours:plan.intervalHours,enabled:plan.enabled}}});
  return {created,updated,unchanged,selected:plan.sourceIds.length,
   note:"Schedules are stored. Collection requires the separately enabled server-side worker; human legal review remains mandatory."};
 },{isolationLevel:"Serializable",timeout:16000,maxWait:3500});
}
