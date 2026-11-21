import {verifiedObservation} from './connector-observation';
import {z} from 'zod';
import type {AuthorizedContext} from './authorization';
import {transaction,IntelligenceError} from './intelligence-service';
import {requireMember,ADMIN,WRITER} from './workspace-member';
import {connectorsEnabled,connectorProviderEnabled} from './connector-flags';
import {followUpConnectorControls} from './connector-reactions';
import {observationCurrent} from '../connectors/observation';
export const connectorControlSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('LINK'),version:z.number().int().positive(),controlId:z.uuid(),controlVersion:z.number().int().positive(),rationale:z.string().trim().min(30).max(1200),confirm:z.literal(true)}),
 z.object({action:z.literal('UNLINK'),version:z.number().int().positive(),linkId:z.uuid(),confirm:z.literal(true)})
]);
export async function changeConnectorControl(ctx:AuthorizedContext,id:string,input:unknown){
 if(!connectorsEnabled())throw new IntelligenceError('Evidence connections await activation',503);
 if(!z.uuid().safeParse(id).success)throw new IntelligenceError('Invalid connection selection');
 const parsed=connectorControlSchema.safeParse(input);if(!parsed.success)throw new IntelligenceError('Choose the control, explain relevance and confirm the evidence link');const d=parsed.data;
 return transaction(ctx,async tx=>{
  await requireMember(tx,ctx,ADMIN);
  const connector=await tx.evidenceConnector.findFirst({where:{id,organizationId:ctx.organizationId}});
  if(!connector)throw new IntelligenceError('Connection not found',404);
  if(connector.version!==d.version)throw new IntelligenceError('Connection settings changed; refresh before changing evidence links',409);
  if(d.action==='UNLINK'){
   const link=await tx.connectorControlLink.findFirst({where:{id:d.linkId,connectorId:id,organizationId:ctx.organizationId}});
   if(!link)throw new IntelligenceError('Evidence link changed or was removed',409);
   await tx.connectorControlLink.delete({where:{id:link.id}});
   await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,entityType:'EvidenceConnector',entityId:id,action:'connector.control_unlinked',details:{linkId:link.id,controlId:link.controlId,rationale:link.rationale}}});
   return {id:link.id,removed:true};
  }
  if(d.controlId===connector.controlId)throw new IntelligenceError('The responsible control already uses this connection',409);
  const control=await tx.managedControl.findFirst({where:{id:d.controlId,organizationId:ctx.organizationId,enabled:true,version:d.controlVersion}});
  if(!control)throw new IntelligenceError('Choose a current active control in this organisation',409);
  await requireMember(tx,{...ctx,userId:control.ownerId},WRITER);
  const existing=await tx.connectorControlLink.findUnique({where:{connectorId_controlId:{connectorId:id,controlId:control.id}}});
  if(existing){if(existing.rationale!==d.rationale)throw new IntelligenceError('A link already exists; remove it before changing its purpose',409);return {id:existing.id,reused:true};}
  if(await tx.connectorControlLink.count({where:{connectorId:id,organizationId:ctx.organizationId}})>=20)throw new IntelligenceError('A connection can support up to twenty additional controls',429);
  const link=await tx.connectorControlLink.create({data:{organizationId:ctx.organizationId,connectorId:id,controlId:control.id,mappedById:ctx.userId,rationale:d.rationale}});
  const run=await tx.connectorRun.findFirst({where:{connectorId:id,organizationId:ctx.organizationId},orderBy:[{capturedAt:'desc'},{id:'desc'}]});
  // Attaching a new control to an already unhealthy source must not wait for another provider request.
  if(!run||!connectorProviderEnabled(connector.provider)||!observationCurrent(run,connector,true)||!verifiedObservation(run)||run.outcome!=='OBSERVED')
   await followUpConnectorControls(tx,connector,'The newly linked connection has no current passing collection. Review its history and the scope relevant to this control.',[control.id]);
  await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,entityType:'EvidenceConnector',entityId:id,action:'connector.control_linked',details:{linkId:link.id,controlId:control.id,controlVersion:control.version,rationale:d.rationale}}});
  return {id:link.id,reused:false};
 });
}
