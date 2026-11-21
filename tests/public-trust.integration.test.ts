import test from 'node:test';
import assert from 'node:assert/strict';
import {assuranceFixture,rejects} from './helpers/assurance-fixture';
import {db} from '../lib/server/db';
import {createAuditRoom,changeAuditRoom,guestAuditAction,openAuditRoom} from '../lib/server/auditor-service';
import {manageTrustPublication,publicSummaries,requestTrustAccess,trustPublicationAdmin} from '../lib/server/trust-publication';

test('public wording, verified named requests and revised or withdrawn private access stay separate across tenants',async()=>{
 const x=await assuranceFixture(),buyer={externalId:x.foreign.externalId,email:x.foreign.email};
 try{
  const file=await x.file(),room=await createAuditRoom(x.o,{title:'Private commercial review',purpose:'Review the original approved private fixture evidence.',expiresAt:new Date(Date.now()+86400000).toISOString(),evidenceIds:[file.id]});
  const claim={action:'PUBLISH',revision:0,title:'Acme public assurance',summary:'Our selected support evidence can be requested for buyer review.',manifestHash:room.manifestHash,confirm:true};
  await assert.rejects(()=>manageTrustPublication(x.o,room.id,claim),rejects(409));
  await changeAuditRoom(x.o,room.id,{action:'PUBLISH',version:1,manifestHash:room.manifestHash,acknowledgeDisclosure:true});
  await assert.rejects(()=>manageTrustPublication(x.out,room.id,claim),rejects(404));
  await manageTrustPublication(x.o,room.id,claim);
  const listings=await publicSummaries({q:'Acme public'}),current=listings.find(c=>c.title===claim.title)!;
  assert.deepEqual(Object.keys(current).sort(),['id','title','summary','revision','expiresAt'].sort());assert.ok(!JSON.stringify(current).includes(file.id));
  assert.equal((await requestTrustAccess(buyer,current.id,{revision:1})).status,'REQUESTED');
  assert.equal((await requestTrustAccess(buyer,current.id,{revision:1})).status,'REQUESTED');
  const req=(await trustPublicationAdmin(x.o,room.id)).requests[0];assert.equal(req.email,buyer.email);
  await assert.rejects(()=>openAuditRoom(buyer,req.id),rejects(404));
  await manageTrustPublication(x.ad,room.id,{action:'APPROVE',revision:1,grantId:req.id,grantVersion:req.version});
  await guestAuditAction(buyer,req.id,{action:'ACCEPT',version:req.version+1});assert.equal((await openAuditRoom(buyer,req.id)).files.length,1);
  await manageTrustPublication(x.o,room.id,{...claim,revision:1,title:'Acme revised assurance'});await assert.rejects(()=>openAuditRoom(buyer,req.id),rejects(404));
  await assert.rejects(()=>requestTrustAccess(buyer,current.id,{revision:1}),rejects(404));
  await requestTrustAccess(buyer,current.id,{revision:2});const revised=(await trustPublicationAdmin(x.o,room.id)).requests[0];
  await manageTrustPublication(x.ad,room.id,{action:'DENY',revision:2,grantId:revised.id,grantVersion:revised.version});
  assert.equal((await requestTrustAccess(buyer,current.id,{revision:2})).status,'DENIED');
  await db.evidence.update({where:{id:file.id},data:{reviewVersion:{increment:1}}});assert.deepEqual(await publicSummaries({id:current.id}),[]);
  await manageTrustPublication(x.o,room.id,{action:'WITHDRAW',revision:2,confirm:true});assert.deepEqual(await publicSummaries({id:current.id}),[]);
 }finally{await x.cleanup();}
});
