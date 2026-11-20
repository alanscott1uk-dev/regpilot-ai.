import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DELIVERY_VERSION,validDeliveryUrl,createDeliveryEndpointInput,deliveryEnvelopeSchema,deliveryBackoff,deliveryHttpOutcome} from '../lib/integration-delivery';
import {DeliveryTransportError,newDeliverySecret,deliverySignature,verifyDeliverySignature,publicDeliveryAddress,sendIntegrationDelivery} from '../lib/server/integration-delivery-transport';
import {startDeliveryReceiver} from './helpers/delivery-receiver.mjs';
const id=randomUUID(),requestKey=randomUUID();

test('endpoint contracts reject private URL syntax, unsolicited fields and excessive scope',()=>{
 for(const url of ['http://receiver.acme.com/events','https://localhost/events','https://127.0.0.1','https://[::1]','https://0x7f000001','https://user:pass@receiver.acme.com','https://receiver.acme.com:8443','https://receiver.acme.com/path?token=secret','https://receiver.acme.com/path#secret','https://receiver.local','https://receiver.acme.com.','https://no-dot','https://-bad.acme.com'])assert.equal(validDeliveryUrl(url),false,url);
 const input={name:'Fictional receiver',url:'https://receiver.acme.com/events',eventTypes:['customer.observation.received'],controlIds:[id],expiresAt:new Date(Date.now()+86400000).toISOString(),requestKey,confirm:true};assert.equal(createDeliveryEndpointInput.parse(input).name,input.name);
 for(const extra of [{...input,secret:'injected'},{...input,eventTypes:['arbitrary.event']},{...input,controlIds:Array(51).fill(id)},{...input,eventTypes:[]},{...input,controlIds:[]}])assert.throws(()=>createDeliveryEndpointInput.parse(extra));
 assert.equal(deliveryBackoff(1),60000);assert.equal(deliveryBackoff(6),21600000);assert.equal(deliveryBackoff(1,999999),86400000);assert.equal(deliveryHttpOutcome(302),'DEAD');assert.equal(deliveryHttpOutcome(429),'RETRY');assert.equal(deliveryHttpOutcome(204),'DELIVERED');
});
test('sender signatures are timestamp-bounded, exact-byte, versioned and tamper evident',()=>{
 const secret=newDeliverySecret(),deliveryId=randomUUID(),timestamp=String(Math.floor(Date.now()/1000)),body='{"value":1}',signature=deliverySignature(secret,deliveryId,timestamp,body);
 assert.equal(verifyDeliverySignature({secret,deliveryId,timestamp,body,signature}),true);for(const altered of [{body:'{ "value":1}'},{secret:newDeliverySecret()},{deliveryId:randomUUID()},{timestamp:String(Number(timestamp)-301)},{signature:'v2='+signature.slice(3)}])assert.equal(verifyDeliverySignature({secret,deliveryId,timestamp,body,signature,...altered}),false);
});
test('public address rules reject every local and reserved IPv4 range and never select IPv6',()=>{
 for(const address of ['0.0.0.0','10.2.3.4','100.64.2.1','127.0.0.1','169.254.169.254','172.16.1.1','192.0.0.9','192.0.2.5','192.168.2.4','198.18.2.1','198.51.100.4','203.0.113.4','224.0.0.1','255.255.255.255','::1','::ffff:127.0.0.1','2606:4700:4700::1111'])assert.equal(publicDeliveryAddress(address),false,address);
 assert.equal(publicDeliveryAddress('93.184.216.34'),true);assert.equal(publicDeliveryAddress('8.8.8.8'),true);
});
test('actual TLS receiver verifies signed raw bytes; redirects and overlarge responses cannot escape transport bounds',async()=>{
 const receiver=await startDeliveryReceiver(),secret=newDeliverySecret(),deliveryId=randomUUID(),eventId=randomUUID(),attemptId=randomUUID(),challenge='a'.repeat(64),payload=deliveryEnvelopeSchema.parse({apiVersion:DELIVERY_VERSION,id:eventId,type:'endpoint.probe',organizationId:randomUUID(),occurredAt:new Date().toISOString(),source:{kind:'ENDPOINT',id,version:1},controlIds:[],data:{endpointId:id,challenge}}),body=JSON.stringify(payload),input={url:receiver.url,body,secret,eventId,deliveryId,attemptId};receiver.setSecrets([secret]);
 try{
  const response=await sendIntegrationDelivery(input,receiver.dependencies);assert.equal(response.status,200);assert.equal(response.challenge,challenge);assert.equal(receiver.records[0].valid,true);assert.equal(receiver.records[0].attemptId,attemptId);assert.equal(response.peerAddressHash.length,64);assert.ok(response.durationMs>=0);
  receiver.setStatus(302);assert.equal((await sendIntegrationDelivery({...input,attemptId:randomUUID()},receiver.dependencies)).status,302);assert.equal(receiver.records.length,2,'a redirect produces one request and is never followed');
  receiver.setOversized(true);await assert.rejects(()=>sendIntegrationDelivery(input,receiver.dependencies),(error:unknown)=>error instanceof DeliveryTransportError&&error.code==='RESPONSE_TOO_LARGE');receiver.setOversized(false);
  let sent=0;const blocked={...receiver.dependencies,resolve:async()=>[{address:'93.184.216.34',family:4},{address:'127.0.0.1',family:4}],request:()=>{sent++;throw Error('must not connect');}};await assert.rejects(()=>sendIntegrationDelivery(input,blocked),(error:unknown)=>error instanceof DeliveryTransportError&&error.code==='DESTINATION_BLOCKED');assert.equal(sent,0);
  await assert.rejects(()=>sendIntegrationDelivery(input,{...receiver.dependencies,resolve:async()=>[{address:'::1',family:6}]}),(error:unknown)=>error instanceof DeliveryTransportError&&error.code==='IPV4_REQUIRED');
  await assert.rejects(()=>sendIntegrationDelivery(input,{...receiver.dependencies,beforeSend:async()=>{throw new DeliveryTransportError('SEND_AUTHORITY_CHANGED');}}),/SEND_AUTHORITY_CHANGED/);assert.equal(receiver.records.length,3,'authority changes after DNS prevent network admission');
 }finally{await receiver.close();}
});
