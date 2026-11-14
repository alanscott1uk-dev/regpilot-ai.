import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import {db} from './db';
import {connectorsEnabled,connectorProviderEnabled} from './connector-flags';
import {encryptConnectorSecret,decryptConnectorSecret} from './connector-secret';
import {transaction,IntelligenceError} from './intelligence-service';
import {requireMember,ADMIN} from './workspace-member';
import type {AuthorizedContext} from './authorization';
import {WebhookError,verifyWebhook,webhookEvent,readWebhookBytes,validWebhookSecret,type WebhookProvider} from '../connectors/webhook-signature';

export const webhooksEnabled=()=>connectorsEnabled()&&process.env.REGPILOT_WEBHOOKS_ENABLED==='true';
const schema=z.object({version:z.number().int().positive(),enabled:z.boolean(),secret:z.string().max(128).optional()}).strict();
export async function configureConnectorWebhook(ctx:AuthorizedContext,id:string,input:unknown){
 if(!webhooksEnabled())throw new IntelligenceError('Integration events await activation',503);
 const v=schema.parse(input);
 return transaction(ctx,async tx=>{
  await requireMember(tx,ctx,ADMIN);
  const row=await tx.evidenceConnector.findFirst({where:{id,organizationId:ctx.organizationId,version:v.version}});
  if(!row)throw new IntelligenceError('Connection not found or changed',409);
  if(!['GITHUB','GITLAB'].includes(row.provider))throw new IntelligenceError('This provider has no event receiver',400);
  if(v.enabled&&(!row.enabled||!connectorProviderEnabled(row.provider)))throw new IntelligenceError('Enable the connection first',409);
  const provider=row.provider as WebhookProvider;
  const secret=v.enabled?(v.secret||(provider==='GITHUB'?randomBytes(32).toString('hex'):'whsec_'+randomBytes(32).toString('base64'))):null;
  if(secret&&!validWebhookSecret(provider,secret))throw new IntelligenceError('Invalid signing secret',400);
  const changed=await tx.evidenceConnector.updateMany({where:{id,organizationId:ctx.organizationId,version:v.version},data:{encryptedWebhookSecret:secret?encryptConnectorSecret(secret,ctx.organizationId,id+':webhook'):null,webhookVersion:{increment:1},version:{increment:1},leaseToken:null,leaseUntil:null}});
  if(!changed.count)throw new IntelligenceError('Connection changed',409);
  await tx.auditEvent.create({data:{organizationId:ctx.organizationId,actorId:ctx.userId,action:'connector.webhook_configured',entityType:'EvidenceConnector',entityId:id,details:{enabled:v.enabled,webhookVersion:row.webhookVersion+1}}});
  return {id,version:v.version+1,webhookVersion:row.webhookVersion+1,enabled:v.enabled,secret,callbackPath:'/api/integrations/webhooks/'+provider.toLowerCase()+'/'+id};
 });
}

/** Authenticate raw bytes, then atomically record a minimal receipt and schedule a
 * fresh provider read. Event payloads never become compliance evidence directly. */
export async function receiveConnectorWebhook(request:Request,provider:WebhookProvider,id:string){
 if(!webhooksEnabled()||!connectorProviderEnabled(provider))throw new WebhookError(503);
 if(!z.uuid().safeParse(id).success)throw new WebhookError(401);
 const row=await db.evidenceConnector.findFirst({where:{id,provider,enabled:true,encryptedWebhookSecret:{not:null}}});
 if(!row)throw new WebhookError(401);
 const body=await readWebhookBytes(request);
 let secret:string;try{secret=decryptConnectorSecret(row.encryptedWebhookSecret!,row.organizationId,id+':webhook');}catch{throw new WebhookError(401);}
 const identity=verifyWebhook(provider,secret,request.headers,body);
 const event=webhookEvent(provider,request.headers,body,row);
 if(!event)return {accepted:true,ignored:true,duplicate:false};
 return db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${row.organizationId},0))`;
  // Configuration changes, permission revocation and collection completion all
  // serialize on this row. No webhook can replace a lease or reset retry budgets.
  const locked=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM "EvidenceConnector" WHERE id=${id}::uuid AND version=${row.version} AND "webhookVersion"=${row.webhookVersion} AND enabled=true FOR UPDATE`;
  if(!locked.length)throw new WebhookError(409);
  const ctx={organizationId:row.organizationId,userId:row.configuredById,role:'ADMIN' as const};
  try{await requireMember(tx,ctx,ADMIN);}catch{throw new WebhookError(403);}
  const control=await tx.managedControl.findFirst({where:{id:row.controlId,organizationId:row.organizationId,enabled:true}});
  if(!control)throw new WebhookError(403);
  const duplicate=await tx.webhookReceipt.findFirst({where:{connectorId:id,webhookVersion:row.webhookVersion,OR:[{deliveryId:identity.deliveryId},{payloadHash:identity.payloadHash}]}});
  if(duplicate){if(duplicate.payloadHash!==identity.payloadHash)throw new WebhookError(409);return {accepted:true,duplicate:true,ignored:false};}
  if(await tx.webhookReceipt.count({where:{connectorId:id}})>=10000)throw new WebhookError(429,'Event retention capacity reached');
  const current=await tx.evidenceConnector.findUniqueOrThrow({where:{id}}),now=Date.now(),revision=current.eventRevision+1;
  const debounce=new Date(now+60000),cooldown=!!current.failureCode&&current.nextRunAt.getTime()>now;
  const nextRunAt=cooldown||current.nextRunAt<debounce?current.nextRunAt:debounce;
  await tx.webhookReceipt.create({data:{connectorId:id,webhookVersion:row.webhookVersion,...identity,event,revision}});
  await tx.evidenceConnector.update({where:{id},data:{eventRevision:revision,nextRunAt}});
  return {accepted:true,duplicate:false,ignored:false};
 },{timeout:8000,maxWait:2000});
}

export async function pruneWebhookReceipts(){
 // One bounded retention batch per primary worker invocation; no raw payloads.
 return db.$executeRaw`WITH old AS (SELECT id FROM "WebhookReceipt" WHERE "receivedAt"<NOW()-interval '30 days' ORDER BY "receivedAt" LIMIT 1000 FOR UPDATE SKIP LOCKED) DELETE FROM "WebhookReceipt" r USING old WHERE r.id=old.id`;
}
