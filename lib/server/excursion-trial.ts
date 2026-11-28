import type {Prisma} from '@prisma/client';
import {z} from 'zod';
import {IntelligenceError} from './intelligence-service';
import {hashValue} from '../regulatory/intelligence';

const steps:Record<string,[string,string]>={
 'link-stock':['QualityExcursion','excursion.link'],
 'investigate-stock':['QualityCase','quality.investigated'],
 'retrieve-pack':['QualityExcursion','excursion.retrieve']
};
export const excursionReceipt=z.object({id:z.uuid(),step:z.string(),at:z.string(),hash:z.string()});
export async function excursionReceipts(tx:Prisma.TransactionClient,org:string,caseId:string|undefined,actor:string,
 start:Date,stop:Date,results:{step:string;outcome:string}[]){
 if(!caseId)return [];
 const receipts:z.infer<typeof excursionReceipt>[]=[];
 for(const result of results.filter(r=>r.outcome==='PASS')){
  const source=steps[result.step];
  if(!source)throw new IntelligenceError('Unknown excursion task',400);
  const event=await tx.auditEvent.findFirst({where:{organizationId:org,entityId:caseId,entityType:source[0],action:source[1],actorId:actor,createdAt:{gte:start,lte:stop}},
   orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true,createdAt:true,details:true}});
  if(!event)throw new IntelligenceError('A passing result requires your saved case action during the timer. Record a blockage or unobserved result if it was not completed.',409);
  receipts.push({id:event.id,step:result.step,at:event.createdAt.toISOString(),hash:hashValue(event.details)});
 }
 return receipts;
}
