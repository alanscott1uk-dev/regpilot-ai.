// Test-only dispatcher: the browser journey invokes this child with fictional
// receiver secrets over stdin. It cannot dispatch to a real configured hostname.
import assert from 'node:assert/strict';
import {z} from 'zod';
import {db} from '../lib/server/db';
import {claimIntegrationDelivery,executeIntegrationDelivery} from '../lib/server/integration-delivery-queue';
import {startDeliveryReceiver,receiverHostname} from '../tests/helpers/delivery-receiver.mjs';
async function main(){
 let text='';for await(const chunk of process.stdin){text+=chunk.toString();if(text.length>4096)throw Error('Fixture input exceeded limit');}
 const input=z.object({organizationId:z.uuid(),deliveryId:z.uuid(),secret:z.string().regex(/^rpd_[A-Za-z0-9_-]{43}$/),status:z.union([z.literal(200),z.literal(400)]).default(200)}).strict().parse(JSON.parse(text));text='';
 const row=await db.integrationDelivery.findFirstOrThrow({where:{id:input.deliveryId,organizationId:input.organizationId},include:{endpoint:true}});assert.equal(row.endpoint.url,'https://'+receiverHostname+'/events');
 const receiver=await startDeliveryReceiver();receiver.setSecrets([input.secret]);receiver.setStatus(input.status);
 try{
  const job=await claimIntegrationDelivery({organizationId:input.organizationId,deliveryId:input.deliveryId});assert.ok(job);const outcome=await executeIntegrationDelivery(job,receiver.dependencies);assert.equal(receiver.records.length,1);assert.equal(receiver.records[0].valid,true);
  const record=receiver.records[0];process.stdout.write(JSON.stringify({outcome,transport:'controlled-local-tls',publicNetworkRequests:0,requests:receiver.records.length,signatureVerified:record.valid,deliveryId:record.deliveryId,eventId:record.eventId,attemptId:record.attemptId,type:record.payload.type,controlIds:record.payload.controlIds,followUpTaskId:record.payload.data.followUpTaskId||null})+'\n');
 }finally{input.secret='';await receiver.close();await db.$disconnect();}
}
void main().catch(async()=>{await db.$disconnect();process.stderr.write('Controlled delivery verification failed; no secret or provider response is included.\n');process.exitCode=1;});
