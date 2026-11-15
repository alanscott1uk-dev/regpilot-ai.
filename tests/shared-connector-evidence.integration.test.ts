import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {db} from '../lib/server/db';
import {transaction} from '../lib/server/intelligence-service';
import {assuranceFixture,rejects} from './helpers/assurance-fixture';
import {saveConnector,claimConnector,executeConnector} from '../lib/server/connector-service';
import {changeConnectorControl} from '../lib/server/connector-control-service';
import {changeObservationChoices,assertChangeObservations} from '../lib/server/change-observations';
import {operationsWorkspace} from '../lib/server/operations-service';
import type {Observation} from '../lib/connectors/observation';

test('one collection supports separate controls, evidence revocation and independently owned follow-up work',async()=>{
 const x=await assuranceFixture();
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'true',REGPILOT_CONNECTORS_ENABLED:'true',REGPILOT_CONNECTOR_ENCRYPTION_KEY:'ab'.repeat(32),SUPABASE_URL:'https://example.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture'});
 const rationale='This fictional system reports settings relevant to the control; each owner must independently assess the scope and limitations.';
 try{
  const programme=await db.programmeImport.create({data:{organizationId:x.a.id,createdById:x.o.userId,inputHash:randomUUID(),method:'SEARCH',status:'ACCEPTED',evidenceManifest:[]}});
  const create=(ownerId:string,title:string)=>db.managedControl.create({data:{organizationId:x.a.id,importId:programme.id,proposalKey:randomUUID(),title,description:'Fictional shared evidence control',testProcedure:'Independently inspect the relevant system settings',theme:'security',ownerId,scheduledById:x.o.userId,intervalDays:30,nextReviewAt:new Date()}});
  const [primary,second,third,fourth]=await Promise.all([create(x.ed.userId,'Connection ownership'),create(x.re.userId,'Access control'),create(x.ad.userId,'Change management'),create(x.ed.userId,'Additional monitoring')]);
  const config={provider:'GITHUB',repository:'fictional/shared',branch:'main',controlId:primary.id,version:0,token:'github_pat_'+'x'.repeat(32),enabled:true,intervalHours:24};
  const saved=await saveConnector(x.o,config);let reads=0;
  async function collect(status:'PASS'|'FAIL'){
   await db.evidenceConnector.update({where:{id:saved.id},data:{nextRunAt:new Date(0)}});
   const job=await claimConnector();assert.ok(job);assert.equal(job.id,saved.id);
   const result:Observation={engine:'shared-fixture-1',sourceUrl:'https://github.com/fictional/shared',capturedAt:new Date().toISOString(),checks:[{id:'review',label:'Review setting',status,observed:status,nextStep:'Inspect relevance to this control'}],limitations:['Fictional configuration only; not a compliance verdict.']};
   await executeConnector(job,async()=>{reads++;return result;});return db.connectorRun.findFirstOrThrow({where:{connectorId:saved.id},orderBy:[{capturedAt:'desc'},{id:'desc'}]});
  }
  const first=await collect('PASS');
  const link=(c:typeof primary)=>({action:'LINK',version:1,controlId:c.id,controlVersion:c.version,rationale,confirm:true});
  await assert.rejects(()=>changeConnectorControl(x.ed,saved.id,link(second)),rejects(403));
  await assert.rejects(()=>changeConnectorControl(x.out,saved.id,link(second)),rejects(404));
  await assert.rejects(()=>changeConnectorControl(x.o,saved.id,{...link(second),controlId:randomUUID()}),rejects(409));
  await assert.rejects(()=>changeConnectorControl(x.o,saved.id,{...link(second),version:2}),rejects(409));
  await assert.rejects(()=>changeConnectorControl(x.o,saved.id,{...link(second),controlVersion:2}),rejects(409));
  await assert.rejects(()=>changeConnectorControl(x.o,saved.id,link(primary)),rejects(409));
  const concurrent=await Promise.all([changeConnectorControl(x.o,saved.id,link(second)),changeConnectorControl(x.o,saved.id,link(second))]);assert.equal(concurrent[0].id,concurrent[1].id);
  await changeConnectorControl(x.o,saved.id,link(third));assert.equal(reads,1);assert.equal(await db.evidenceConnector.count({where:{organizationId:x.a.id}}),1);
  const choices=(controlId:string)=>transaction(x.o,tx=>changeObservationChoices(tx,x.a.id,controlId));
  const primaryProof=await choices(primary.id),secondProof=await choices(second.id);assert.equal(primaryProof[0].id,first.id);assert.equal(secondProof[0].id,first.id);assert.equal(secondProof[0].scopeLinkId,concurrent[0].id);assert.equal(secondProof[0].scopeMappedById,x.o.userId);assert.equal(secondProof[0].scopeRationale,rationale);assert.equal(primaryProof[0].scopeLinkId,undefined);assert.deepEqual(await choices(fourth.id),[]);
  const workspace=await operationsWorkspace(x.o);assert.equal(workspace.connectors[0].controlLinks.length,2);assert.doesNotMatch(JSON.stringify(workspace),/github_pat_|encryptedSecret|leaseToken/);
  await assert.rejects(()=>db.connectorControlLink.create({data:{organizationId:x.b.id,connectorId:saved.id,controlId:second.id,mappedById:x.out.userId,rationale}}),(e:any)=>e.code==='P2003');
  await changeConnectorControl(x.o,saved.id,{action:'UNLINK',version:1,linkId:concurrent[0].id,confirm:true});
  assert.deepEqual(await choices(second.id),[]);await assert.rejects(()=>transaction(x.o,tx=>assertChangeObservations(tx,x.a.id,second.id,secondProof)),rejects(409));
  await transaction(x.o,tx=>assertChangeObservations(tx,x.a.id,primary.id,primaryProof));
  const relinked=await changeConnectorControl(x.o,saved.id,link(second));assert.notEqual(relinked.id,concurrent[0].id);
  await assert.rejects(()=>transaction(x.o,tx=>assertChangeObservations(tx,x.a.id,second.id,secondProof)),rejects(409));
  await transaction(x.o,async tx=>assertChangeObservations(tx,x.a.id,second.id,await changeObservationChoices(tx,x.a.id,second.id)));
  assert.equal(reads,1,'linking, unlinking and relinking must not fetch the provider or duplicate credentials');
  await collect('FAIL');let tasks=await db.obligation.findMany({where:{connectorId:saved.id,status:{not:'COMPLETE'}}});assert.equal(tasks.length,3);assert.deepEqual(new Set(tasks.map(t=>t.assigneeId)),new Set([x.ed.userId,x.re.userId,x.ad.userId]));
  await collect('FAIL');assert.equal(await db.obligation.count({where:{connectorId:saved.id,status:{not:'COMPLETE'}}}),3,'repeated failures do not duplicate open work');
  const before=reads;await changeConnectorControl(x.o,saved.id,link(fourth));assert.equal(reads,before);assert.equal(await db.obligation.count({where:{connectorId:saved.id,controlId:fourth.id,status:{not:'COMPLETE'}}}),1,'an already unhealthy source immediately alerts a newly linked owner');
  await changeConnectorControl(x.o,saved.id,{action:'UNLINK',version:1,linkId:relinked.id,confirm:true});
  await db.obligation.updateMany({where:{connectorId:saved.id,controlId:second.id},data:{status:'COMPLETE'}});await collect('FAIL');assert.equal(await db.obligation.count({where:{connectorId:saved.id,controlId:second.id,status:{not:'COMPLETE'}}}),0,'removed controls receive no new work');
  await collect('PASS');assert.equal(await db.obligation.count({where:{connectorId:saved.id,status:{not:'COMPLETE'}}}),3,'a passing observation does not approve or close human work');
  await db.managedControl.update({where:{id:third.id},data:{enabled:false}});assert.deepEqual(await choices(third.id),[]);assert.equal((await choices(primary.id)).length,1,'pausing a secondary control does not stop other consumers');
  const revoked=await create(x.st.userId,'Invalid owner');await assert.rejects(()=>changeConnectorControl(x.o,saved.id,link(revoked)),rejects(403));
  await saveConnector(x.o,{...config,id:saved.id,version:1,controlId:fourth.id});assert.equal(await db.connectorControlLink.count({where:{connectorId:saved.id,controlId:fourth.id}}),0,'primary promotion removes a duplicate secondary link');
  const bounded=await Promise.all(Array.from({length:20},(_,i)=>create(x.ed.userId,'Bounded scope '+i)));
  await db.connectorControlLink.createMany({data:bounded.slice(0,19).map(c=>({organizationId:x.a.id,connectorId:saved.id,controlId:c.id,mappedById:x.o.userId,rationale}))});
  await assert.rejects(()=>changeConnectorControl(x.o,saved.id,{...link(bounded[19]),version:2}),rejects(429));
  assert.ok(await db.auditEvent.count({where:{organizationId:x.a.id,action:'connector.control_linked'}})>=3);
 }finally{await x.cleanup();}
});
