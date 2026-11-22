import {z} from 'zod';
import {isModelConnector,collectModelAccess} from '../connectors/direct-model';
import {readRecordKeys} from '../connectors/operational-records';
import {connectorProviderEnabled} from './connector-flags';
import {decryptConnectorSecret} from './connector-secret';
import {IntelligenceError,transaction} from './intelligence-service';
import {ADMIN,WRITER,requireMember} from './workspace-member';
import type {AuthorizedContext} from './authorization';

export const directBinding=z.object({
 transport:z.literal('direct'),connectionId:z.uuid(),configVersion:z.number().int().positive(),
 provider:z.enum(['openai','private']),model:z.string().min(1).max(80)
}).strict();
export type DirectBinding=z.infer<typeof directBinding>;

export async function modelConnections(ctx:AuthorizedContext){
 return transaction(ctx,async tx=>{
  await requireMember(tx,ctx,ADMIN);
  const rows=await tx.evidenceConnector.findMany({where:{organizationId:ctx.organizationId,enabled:true,control:{enabled:true},provider:{in:['OPENAI_PROJECT_MODEL','PRIVATE_AI_MODEL']}},select:{id:true,version:true,repository:true,branch:true,provider:true},orderBy:{id:'asc'},take:500});
  return rows.flatMap(row=>{
   if(!isModelConnector(row.provider)||!connectorProviderEnabled(row.provider))return [];
   const {scope,record}=readRecordKeys(row.provider,row.repository,row.branch);
   return [{id:row.id,version:row.version,scope,model:record}];
  });
 });
}
export async function readModelConnection(ctx:AuthorizedContext,id:string,version:number){
 return transaction(ctx,async tx=>{
  await requireMember(tx,ctx,WRITER);
  const row=await tx.evidenceConnector.findFirst({where:{id,version,organizationId:ctx.organizationId,enabled:true,control:{enabled:true}},select:{provider:true,repository:true,branch:true,encryptedSecret:true}});
  if(!row?.encryptedSecret||!isModelConnector(row.provider)||!connectorProviderEnabled(row.provider))throw new IntelligenceError('Refresh the model connection after rotation, removal or a configuration change.',409);
  const {scope,record}=readRecordKeys(row.provider,row.repository,row.branch);
  const provider=row.provider==='OPENAI_PROJECT_MODEL'?'openai' as const:'private' as const;
  return {transport:'direct' as const,modelConnector:row.provider,scope,connectionId:id,configVersion:version,model:record,provider,key:decryptConnectorSecret(row.encryptedSecret,ctx.organizationId,id)};
 });
}
export async function verifyModelConnection(ctx:AuthorizedContext,id:string,version:number,fetcher:typeof fetch){
 const account=await readModelConnection(ctx,id,version);
 await collectModelAccess(account.modelConnector,{scope:account.scope,record:account.model},account.key,fetcher);
 return directBinding.parse({transport:'direct',connectionId:id,configVersion:version,provider:account.provider,model:account.model});
}
