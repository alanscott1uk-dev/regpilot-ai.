import {reservePaid} from "./paid-budget";
import {db} from "./db";
import type {AuthorizedContext} from "./authorization";
export class DailyLimitError extends Error {constructor(){super("Daily AI request allowance reached");this.name="DailyLimitError";}}
const max=(value:string|undefined,fallback:number,upper:number)=>{
 const v=Number(value);
 return Number.isInteger(v)&&v>=1&&v<=upper?v:fallback;
};
export function aiDailyLimits(){
 return {perUser:max(process.env.REGPILOT_AI_DAILY_USER_LIMIT,10,100),perOrg:max(process.env.REGPILOT_AI_DAILY_ORG_LIMIT,40,1000)};
}
export async function reserveAiRequest(ctx:AuthorizedContext,mode:string){
 const {perUser,perOrg}=aiDailyLimits();
 const day=new Date(new Date().toISOString().slice(0,10)+"T00:00:00.000Z");
 const id=crypto.randomUUID();
 await db.$transaction(async tx=>{
  await reservePaid(tx,ctx,"AI","ai:"+id);
  const total=await tx.aiDailyUsage.aggregate({where:{organizationId:ctx.organizationId,day},_sum:{count:true}});
  if((total._sum.count||0)>=perOrg)throw new DailyLimitError();
  await tx.aiDailyUsage.upsert({
   where:{organizationId_userId_day:{organizationId:ctx.organizationId,userId:ctx.userId,day}},
   create:{organizationId:ctx.organizationId,userId:ctx.userId,day,count:0},update:{}
  });
  const changed=await tx.aiDailyUsage.updateMany({
   where:{organizationId:ctx.organizationId,userId:ctx.userId,day,count:{lt:perUser}},
   data:{count:{increment:1}}
  });
  if(changed.count!==1)throw new DailyLimitError();
  await tx.auditEvent.create({
   data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:"ai.request_reserved",entityType:"AiRequest",entityId:id,details:{mode,day:day.toISOString().slice(0,10)}}
  });
 },{isolationLevel:"Serializable",maxWait:3000,timeout:6000});
 return id;
}
