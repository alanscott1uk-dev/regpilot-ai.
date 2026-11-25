import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {resourcePolicy,type ResourcePolicy} from '../connectors/resource-control';
import {db} from './db';
import {requireMember,ADMIN} from './workspace-member';
import {IntelligenceError,transaction} from './intelligence-service';
import type {AuthorizedContext} from './authorization';
import {hashValue} from '../regulatory/intelligence';
export type ModelScope={provider:string;integration:string;connectionId:string;model:string};
export async function saveManagedPolicy(ctx:AuthorizedContext,scope:ModelScope,policy:ResourcePolicy){
 const bound=resourcePolicy.parse(policy),details={...scope,policy:bound},fingerprint=hashValue(details);
 return transaction(ctx,async tx=>{
  await requireMember(tx,ctx,ADMIN);
  const where={organizationId:ctx.organizationId,entityType:'ManagedControlPolicy',entityId:fingerprint,action:'sync.policy-bound'};
  const prior=await tx.auditEvent.findFirst({where,select:{id:true}});
  const event=prior??await tx.auditEvent.create({data:{...where,id:randomUUID(),actorId:ctx.userId,details},select:{id:true}});
  const controls=await tx.managedControl.findMany({where:{organizationId:ctx.organizationId,enabled:true},orderBy:[{title:'asc'},{id:'asc'}],select:{id:true,title:true},take:1000});
  return {policyId:event.id,profile:bound.profile,controls};
 });
}
export async function readManagedPolicy(org:string,id:string,scope:ModelScope){
 const row=await db.auditEvent.findFirst({where:{id:z.uuid().parse(id),organizationId:org,entityType:'ManagedControlPolicy',action:'sync.policy-bound'},select:{entityId:true,details:true}});
 const stored=row?.details as (ModelScope&{policy:ResourcePolicy})|null;
 if(!stored||!row||hashValue(stored)!==row.entityId||Object.entries(scope).some(([k,v])=>stored[k as keyof ModelScope]!==v))throw new IntelligenceError('The control mapping is unavailable for this source',409);
 return resourcePolicy.parse(stored.policy);
}
