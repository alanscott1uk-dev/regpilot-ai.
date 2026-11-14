import type {Prisma} from "@prisma/client";
import {IntelligenceError,transaction} from "./intelligence-service";
import {requireMember,WRITER} from "./workspace-member";
import type {AuthorizedContext} from "./authorization";
import {positiveInt,paidMaster} from "../services/config";
export const monthStart=()=>new Date(new Date().toISOString().slice(0,7)+"-01T00:00:00Z");
export async function reservePaid(tx:Prisma.TransactionClient,ctx:AuthorizedContext,service:string,requestKey:string,units=1){
 if(!paidMaster())throw new IntelligenceError("Paid services await activation",503);
 await requireMember(tx,ctx,WRITER);
 // Serialise the platform allowance across organisations, including simultaneous workers.
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('regpilot-paid-budget', 0))`;
 const existing=await tx.paidReservation.findUnique({where:{organizationId_requestKey:{organizationId:ctx.organizationId,requestKey}}});
 if(existing){if(existing.service!==service||existing.units!==units||existing.userId!==ctx.userId)throw new IntelligenceError("Reservation does not match this operation",409);return existing;}
 const unit=positiveInt(process.env["REGPILOT_"+service+"_RESERVE_MICROS"]),platformCap=positiveInt(process.env.REGPILOT_PAID_PLATFORM_MONTHLY_MICROS),defaultCap=positiveInt(process.env.REGPILOT_PAID_ORG_MONTHLY_MICROS);
 if(!unit||!platformCap||!defaultCap||!Number.isSafeInteger(units)||units<1||units>40||unit*units>2_000_000_000)throw new IntelligenceError("Paid-service spending limits await configuration",503);
 const budget=await tx.paidBudget.findUnique({where:{organizationId:ctx.organizationId}}),orgCap=budget?Math.min(defaultCap,budget.monthlyLimitMicros):defaultCap,month=monthStart();
 const [all,org]=await Promise.all([tx.paidReservation.aggregate({where:{month},_sum:{reservedMicros:true}}),tx.paidReservation.aggregate({where:{month,organizationId:ctx.organizationId},_sum:{reservedMicros:true}})]),reservedMicros=unit*units;
 if((all._sum.reservedMicros||0)+reservedMicros>platformCap||(org._sum.reservedMicros||0)+reservedMicros>orgCap)throw new IntelligenceError("Reserved spending allowance reached",429);
 return tx.paidReservation.create({data:{organizationId:ctx.organizationId,userId:ctx.userId,requestKey,service,units,reservedMicros,month}});
}
export async function setPaidBudget(ctx:AuthorizedContext,limit:number,version:number,remindersEnabled?:boolean){return transaction(ctx,async tx=>{await requireMember(tx,ctx,["OWNER"]);if(!Number.isInteger(limit)||limit<0||limit>2_000_000_000||!Number.isInteger(version)||version<0)throw new IntelligenceError("Invalid budget");const old=await tx.paidBudget.findUnique({where:{organizationId:ctx.organizationId}});if((old?.version||0)!==version)throw new IntelligenceError("Budget changed; refresh first",409);const row=await tx.paidBudget.upsert({where:{organizationId:ctx.organizationId},create:{organizationId:ctx.organizationId,monthlyLimitMicros:limit,remindersEnabled:remindersEnabled===true,configuredById:ctx.userId},update:{monthlyLimitMicros:limit,...(typeof remindersEnabled==="boolean"?{remindersEnabled,configuredById:ctx.userId}:{}),version:{increment:1}}});await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"services.budget_prepared",entityType:"PaidBudget",entityId:ctx.organizationId,details:{limit,version:row.version}}});return row;});}
