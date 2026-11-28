import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {db} from '../lib/server/db';
import type {AuthorizedContext} from '../lib/server/authorization';
import {evidenceLibrary} from '../lib/server/evidence-library-service';
import {parseEvidenceLibraryQuery} from '../lib/evidence-library.mjs';
import {createEvidence,reviewEvidence} from '../lib/server/evidence-service';
import {prepareAssurance,reviewAssurance} from '../lib/server/assurance-service';
import {saveBusinessProfile,createIntelligenceRun,decideCandidate} from '../lib/server/intelligence-service';
import {hashValue,type Analysis} from '../lib/regulatory/intelligence';
import type {AssuranceResult} from '../lib/evidence/assurance';
import type {EvidenceObjectStore} from '../lib/server/evidence-storage';
import {sourceTextHash} from '../lib/regulatory/source-fingerprint.mjs';
import {fixturePdf} from './helpers/pdf-fixture.mjs';

const query=(values:Record<string,string>={})=>parseEvidenceLibraryQuery(new URLSearchParams(values));
async function cleanup(orgs:string[],users:string[]){
 for(const model of [db.assuranceAssessment,db.intelligenceDecision,db.intelligenceRun,db.businessProfile,db.auditEvent,db.evidence,db.obligation,db.regulatorySnapshot,db.membership] as any[])await model.deleteMany({where:{organizationId:{in:orgs}}});
 await db.organization.deleteMany({where:{id:{in:orgs}}});await db.user.deleteMany({where:{id:{in:users}}});
}
test('evidence library searches and pages the whole company while keeping exact file and membership boundaries',async()=>{
 const suffix=randomUUID(),users=await Promise.all(['owner','editor','viewer','foreign'].map(name=>db.user.create({data:{externalId:name+suffix,email:name+suffix+'@example.invalid'}}))),orgs=await Promise.all(['A','B'].map(name=>db.organization.create({data:{name:'Fictional evidence library '+name+suffix}})));
 const owner:AuthorizedContext={organizationId:orgs[0].id,userId:users[0].id,role:'OWNER'},editor:AuthorizedContext={...owner,userId:users[1].id,role:'EDITOR'},viewer:AuthorizedContext={...owner,userId:users[2].id,role:'VIEWER'},foreign:AuthorizedContext={organizationId:orgs[1].id,userId:users[3].id,role:'OWNER'},old=process.env.REGPILOT_AI_ALLOWED_EMAILS;
 process.env.REGPILOT_AI_ALLOWED_EMAILS=users.map(u=>u.email).join(',');
 try{
  await db.membership.createMany({data:[owner,editor,viewer,foreign]});
  const tasks=await Promise.all([owner,foreign].map((c,i)=>db.obligation.create({data:{organizationId:c.organizationId,title:i?'Foreign hidden task':'Original annual record task',category:'Fictional',ownerName:users[i?3:0].email,assigneeId:c.userId,dueDate:new Date()}})));
  const time=new Date('2026-01-01T12:00:00Z');
  await db.evidence.createMany({data:Array.from({length:81},(_,i)=>({organizationId:owner.organizationId,obligationId:tasks[0].id,filename:i===80?'literal_100%_record.pdf':'record-'+String(i).padStart(3,'0')+(i%2?'.docx':'.pdf'),contentType:i%2?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'application/pdf',storageKey:'DO_NOT_EXPOSE_'+i,sha256:hashValue(i),sizeBytes:100+i,scanStatus:i===79?'QUARANTINED':'CLEAN',reviewStatus:i<30?'APPROVED':i<70?'PENDING_REVIEW':'REJECTED',uploadedById:i%2?editor.userId:owner.userId,reviewerId:i<30?editor.userId:null,reviewedAt:i<30?time:null,reviewVersion:i<30?2:1,createdAt:time}))});
  const secret=await db.evidence.create({data:{organizationId:foreign.organizationId,obligationId:tasks[1].id,filename:'Foreign hidden file.pdf',storageKey:'FOREIGN_SECRET',sha256:'f'.repeat(64),sizeBytes:40,contentType:'application/pdf',scanStatus:'CLEAN',reviewStatus:'PENDING_REVIEW',uploadedById:foreign.userId}});
  const first=await evidenceLibrary(owner,query()),second=await evidenceLibrary(owner,query({page:'2'})),last=await evidenceLibrary(owner,query({page:'99999'}));
  assert.deepEqual(first.summary,{all:81,approved:30,pending:40,rejected:10,quarantined:1,mine:41});assert.equal(first.total,81);assert.equal(first.items.length,25);assert.equal(first.pages,4);assert.equal(last.page,4);assert.equal(last.items.length,6);assert.equal(new Set([...first.items,...second.items].map(file=>file.id)).size,50);
  assert.deepEqual((await evidenceLibrary(owner,query())).items.map(file=>file.id),first.items.map(file=>file.id),'equal timestamps retain deterministic ID ordering');
  assert.doesNotMatch(JSON.stringify(first),/storageKey|DO_NOT_EXPOSE|FOREIGN_SECRET|Foreign hidden/);
  assert.equal((await evidenceLibrary(owner,query({q:'record-078'}))).total,1,'search reaches the complete inventory');
  assert.equal((await evidenceLibrary(owner,query({q:'annual record task'}))).total,81,'search includes the original task');
  assert.equal((await evidenceLibrary(owner,query({q:'100%'}))).total,1,'percentage is a literal search character');
  assert.equal((await evidenceLibrary(owner,query({q:'literal_'}))).total,1,'underscore is literal');
  assert.equal((await evidenceLibrary(owner,query({review:'approved',format:'docx'}))).total,15);
  assert.equal((await evidenceLibrary(editor,query({uploader:'mine'}))).total,40);
  assert.equal((await evidenceLibrary(owner,query({review:'pending'}))).summary.all,81,'summary counts stay company-wide under filtering');
  const exact=await evidenceLibrary(owner,query({evidenceId:last.items[0].id,q:'no-match'}));assert.equal(exact.total,0);assert.equal(exact.selected?.id,last.items[0].id,'exact file is independent of current search results');assert.equal(exact.selected?.originalTask.id,tasks[0].id);
  await assert.rejects(()=>evidenceLibrary(owner,query({evidenceId:secret.id})),(e:any)=>e.status===404);
  await assert.rejects(()=>evidenceLibrary({...foreign,organizationId:owner.organizationId},query()),(e:any)=>e.status===403);
  assert.equal((await evidenceLibrary(viewer,query())).items.every(file=>!file.canReview&&!file.canReuse),true);
  await db.membership.update({where:{organizationId_userId:{organizationId:owner.organizationId,userId:owner.userId}},data:{role:'VIEWER'}});
  const demoted=await evidenceLibrary(owner,query());assert.equal(demoted.role,'VIEWER');assert.equal(demoted.canPrepare,false,'stored membership wins over stale OWNER context');
  await db.membership.delete({where:{organizationId_userId:{organizationId:owner.organizationId,userId:owner.userId}}});await assert.rejects(()=>evidenceLibrary(owner,query()),(e:any)=>e.status===403);
 }finally{if(old===undefined)delete process.env.REGPILOT_AI_ALLOWED_EMAILS;else process.env.REGPILOT_AI_ALLOWED_EMAILS=old;await cleanup(orgs.map(o=>o.id),users.map(u=>u.id));}
});

test('evidence library reuses one canonical file and reports exact current and changed assessment uses without reading bytes',async()=>{
 const suffix=randomUUID(),users=await Promise.all(['author','reviewer','uploader','viewer'].map(name=>db.user.create({data:{externalId:name+suffix,email:name+suffix+'@example.invalid'}}))),org=await db.organization.create({data:{name:'Fictional reusable evidence '+suffix}});
 const author:AuthorizedContext={organizationId:org.id,userId:users[0].id,role:'OWNER'},reviewer:AuthorizedContext={...author,userId:users[1].id,role:'ADMIN'},uploader:AuthorizedContext={...author,userId:users[2].id,role:'EDITOR'},viewer:AuthorizedContext={...author,userId:users[3].id,role:'VIEWER'};
 const settings={REGPILOT_WORKSPACE_ENABLED:'true',REGPILOT_EVIDENCE_ENABLED:'true',REGPILOT_ASSURANCE_ENABLED:'true',SUPABASE_URL:'https://example.invalid',SUPABASE_PUBLISHABLE_KEY:'fictional',SUPABASE_SECRET_KEY:'fictional',REGPILOT_EVIDENCE_BUCKET:'fictional',REGPILOT_CLAMD_HOST:'fictional',REGPILOT_AI_ALLOWED_EMAILS:users.map(u=>u.email).join(',')},old=Object.fromEntries(Object.keys(settings).map(key=>[key,process.env[key]]));Object.assign(process.env,settings);
 const objects=new Map<string,Uint8Array>();let reads=0,puts=0;const storage:EvidenceObjectStore={async put(key,bytes){puts++;objects.set(key,Uint8Array.from(bytes));},async get(key){reads++;const bytes=objects.get(key);if(!bytes)throw new Error('Missing fictional evidence');return Uint8Array.from(bytes);},async remove(key){objects.delete(key);}};
 const text='Fictional widget staff must complete documented training before working alone. This fictional publication describes retained training records.',notes='Independently reviewed the fictional record, quoted passages, task scope and current supporting evidence.';
 try{
  await db.membership.createMany({data:[author,reviewer,uploader,viewer]});
  const original=await db.obligation.create({data:{organizationId:org.id,title:'Original training record collection',category:'Fictional evidence',ownerName:users[2].email,assigneeId:uploader.userId,dueDate:new Date()}});
  const file=await createEvidence(uploader,original.id,'shared-training-record.pdf',fixturePdf([['FICTIONAL TRAINING RECORD','Widget staff completed documented training with a supervisor before working alone.']]),{storage,scan:async()=>({status:'CLEAN',engine:'fictional-test-scanner'})});
  assert.equal((await evidenceLibrary(author,query({evidenceId:file.id}))).selected?.canReuse,true,'clean pending files retain existing assessment-preparation authority');
  await reviewEvidence(reviewer,file.id,{decision:'APPROVED',version:1,notes},storage);
  await saveBusinessProfile(author,{activities:['personal-data'],jurisdictions:['Scotland']},0);
  const source=await db.regulatorySnapshot.create({data:{organizationId:org.id,sourceId:'uk-data-protection',title:'Fictional reuse source',url:'https://www.gov.uk/data-protection-your-business',bodyText:text,contentHash:sourceTextHash(text),capturedById:author.userId,reviewStatus:'REVIEWED',reviewerId:reviewer.userId,reviewedAt:new Date()}});
  const run=await createIntelligenceRun(author,source.id),row=await db.intelligenceRun.findUniqueOrThrow({where:{id:run.id}}),candidate=(row.result as unknown as Analysis).candidates[0];
  const decision=await decideCandidate(reviewer,run.id,{candidateKey:candidate.key,decision:'ACCEPTED',rationale:notes,title:'Use existing training proof for a source-linked task',assigneeId:author.userId,ownerName:'Fictional author',dueDate:'2027-01-31'}),taskId=decision.obligationId!;
  const beforeReads=reads,detail=await evidenceLibrary(author,query({evidenceId:file.id}));assert.equal(reads,beforeReads,'inventory/detail performs no original-file download');assert.equal(detail.selected?.originalTask.id,original.id);assert.equal(detail.selected?.targets.total,1);
  const target=new URL(detail.selected!.targets.items[0].href,'https://example.invalid');assert.equal(target.searchParams.get('evidenceId'),file.id);assert.equal(target.searchParams.get('taskId'),taskId);assert.equal(target.searchParams.get('organizationId'),org.id);
  const prepared=await prepareAssurance(author,{taskId,evidenceIds:[file.id],method:'CONTENT_SEARCH',consent:true},{storage});
  assert.equal(await db.evidence.count({where:{organizationId:org.id}}),1);assert.equal(objects.size,1);assert.equal(puts,1,'reuse never uploads another copy');assert.equal((await db.evidence.findUniqueOrThrow({where:{id:file.id}})).obligationId,original.id,'original attachment provenance remains unchanged');
  let used=await evidenceLibrary(author,query({evidenceId:file.id}));assert.equal(used.selected?.uses.total,1);assert.equal(used.selected?.uses.items[0].id,prepared.id);assert.equal(used.selected?.uses.items[0].status,'DRAFT');assert.equal(used.selected?.uses.items[0].current,true,'current context does not mean approved');
  const assessment=await db.assuranceAssessment.findUniqueOrThrow({where:{id:prepared.id}}),result=assessment.result as unknown as AssuranceResult;
  await reviewAssurance(reviewer,prepared.id,{decision:'ACCEPTED',version:1,notes,passageKeys:[result.passages[0].key],validUntil:new Date(Date.now()+30*86400000).toISOString().slice(0,10),scopeConfirmed:true,originalsChecked:true},{storage});
  const afterApprovalReads=reads;used=await evidenceLibrary(viewer,query({evidenceId:file.id}));assert.equal(reads,afterApprovalReads);assert.equal(used.selected?.uses.items[0].current,true);assert.equal(used.selected?.canReuse,false);assert.equal(used.selected?.targets.total,0);assert.doesNotMatch(JSON.stringify(used),/storageKey|evidenceManifest|bodyText|selectedPassages|resultHash/);
  await db.membership.update({where:{organizationId_userId:{organizationId:org.id,userId:reviewer.userId}},data:{role:'VIEWER'}});assert.equal((await evidenceLibrary(author,query({evidenceId:file.id}))).selected?.uses.items[0].current,false,'revoked reviewer eligibility never appears current');await db.membership.update({where:{organizationId_userId:{organizationId:org.id,userId:reviewer.userId}},data:{role:'ADMIN'}});
  await db.evidence.update({where:{id:file.id},data:{reviewVersion:{increment:1}}});used=await evidenceLibrary(author,query({evidenceId:file.id}));assert.equal(used.selected?.uses.items[0].current,false);assert.match(used.selected!.uses.items[0].reason,/changed/i);await db.evidence.update({where:{id:file.id},data:{reviewVersion:2}});
  await db.assuranceAssessment.update({where:{id:prepared.id},data:{resultHash:'0'.repeat(64)}});assert.equal((await evidenceLibrary(author,query({evidenceId:file.id}))).selected?.uses.items[0].current,false,'tampered accepted content remains visible as unavailable');await db.assuranceAssessment.update({where:{id:prepared.id},data:{resultHash:assessment.resultHash}});
  await db.assuranceAssessment.createMany({data:Array.from({length:11},(_,i)=>({organizationId:org.id,obligationId:taskId,snapshotId:source.id,profileVersion:1,inputHash:hashValue({i,fixture:true}),engineVersion:'fictional-history',method:'CONTENT_SEARCH',evidenceManifest:assessment.evidenceManifest!,createdById:author.userId,status:'FAILED',createdAt:new Date(Date.now()+i)}))});
  used=await evidenceLibrary(author,query({evidenceId:file.id}));assert.equal(used.selected?.uses.total,12);assert.equal(used.selected?.uses.items.length,10);assert.equal(used.selected?.uses.truncated,true);assert.equal(used.selected?.uses.items.every(use=>!use.current),true);
  // These extra records test the picker population, not the semantic validity of their fictional candidates.
  const taskIds=Array.from({length:32},()=>randomUUID());
  await db.obligation.createMany({data:taskIds.map((id,i)=>({id,organizationId:org.id,title:'Fictional reusable target '+String(i).padStart(2,'0'),category:'Target paging fixture',ownerName:users[0].email,assigneeId:author.userId,dueDate:new Date('2027-02-01'),originKey:hashValue({id}),status:i===31?'COMPLETE':'OPEN'}))});
  await db.intelligenceDecision.createMany({data:taskIds.map(id=>({organizationId:org.id,runId:run.id,candidateKey:hashValue({fixtureTarget:id}),decision:'ACCEPTED',rationale:'Fictional records for target pagination only.',reviewerId:reviewer.userId,obligationId:id}))});
  const firstTargets=(await evidenceLibrary(author,query({evidenceId:file.id}))).selected!.targets,lastTargets=(await evidenceLibrary(author,query({evidenceId:file.id,targetPage:'2'}))).selected!.targets;
  assert.equal(firstTargets.total,32);assert.equal(firstTargets.items.length,25);assert.equal(lastTargets.items.length,7);assert.equal(new Set([...firstTargets.items,...lastTargets.items].map(item=>item.id)).size,32);assert.equal(firstTargets.items.some(item=>item.id===taskIds[31]),false,'completed tasks are excluded');
  const sought=(await evidenceLibrary(author,query({evidenceId:file.id,targetQ:'reusable target 30'}))).selected!.targets;assert.equal(sought.total,1);assert.equal(sought.items[0].id,taskIds[30],'target search spans the whole company');
  await db.evidence.update({where:{id:file.id},data:{scanStatus:'QUARANTINED'}});used=await evidenceLibrary(author,query({evidenceId:file.id}));assert.equal(used.selected?.canReuse,false);assert.equal(used.selected?.targets.total,0);
 }finally{for(const [key,value] of Object.entries(old))if(value===undefined)delete process.env[key];else process.env[key]=value;await cleanup([org.id],users.map(u=>u.id));await db.$disconnect();}
});
