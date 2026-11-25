import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {db} from '../lib/server/db';
import type {AuthorizedContext} from '../lib/server/authorization';
import {STARTER_PACKS,type StarterPlan} from '../lib/starter-programmes.mjs';
import {planStarterProgramme,starterProgrammeWorkspace} from '../lib/server/starter-programme-service';
import {createEvidence,reviewEvidence} from '../lib/server/evidence-service';
import {workCompletion,completeWork} from '../lib/server/work-completion-service';
import type {EvidenceObjectStore} from '../lib/server/evidence-storage';
import {fixturePdf} from './helpers/pdf-fixture.mjs';

async function setup(){
 const suffix=randomUUID(),users=await Promise.all(['owner','reviewer','editor','viewer','foreign'].map(name=>db.user.create({data:{externalId:name+suffix,email:name+suffix+'@example.invalid'}}))),orgs=await Promise.all(['A','B'].map(name=>db.organization.create({data:{name:'Fictional starter programme '+name+suffix}})));
 const owner:AuthorizedContext={organizationId:orgs[0].id,userId:users[0].id,role:'OWNER'},reviewer:AuthorizedContext={...owner,userId:users[1].id,role:'ADMIN'},editor:AuthorizedContext={...owner,userId:users[2].id,role:'EDITOR'},viewer:AuthorizedContext={...owner,userId:users[3].id,role:'VIEWER'},foreign:AuthorizedContext={organizationId:orgs[1].id,userId:users[4].id,role:'OWNER'};
 await db.membership.createMany({data:[owner,reviewer,editor,viewer,foreign]});const previous=process.env.REGPILOT_AI_ALLOWED_EMAILS;process.env.REGPILOT_AI_ALLOWED_EMAILS=users.map(user=>user.email).join(',');
 const clean=async()=>{if(previous===undefined)delete process.env.REGPILOT_AI_ALLOWED_EMAILS;else process.env.REGPILOT_AI_ALLOWED_EMAILS=previous;for(const model of [db.auditEvent,db.evidence,db.obligation,db.membership] as any[])await model.deleteMany({where:{organizationId:{in:orgs.map(org=>org.id)}}});await db.organization.deleteMany({where:{id:{in:orgs.map(org=>org.id)}}});await db.user.deleteMany({where:{id:{in:users.map(user=>user.id)}}});};
 return {users,orgs,owner,reviewer,editor,viewer,foreign,clean};
}
function plan(assigneeId:string,pack=STARTER_PACKS[0]):StarterPlan{return {packId:pack.id,packVersion:pack.version,name:'Fictional '+pack.title,scopeRationale:'These selected operational tasks fit the fictional company and its declared working activities.',items:pack.items.slice(0,2).map(({key,title,description,why})=>({key,title,description,why,assigneeId,dueDate:new Date(Date.now()+14*86400000).toISOString().slice(0,10)}))};}
async function preview(ctx:AuthorizedContext,input:StarterPlan){const result=await planStarterProgramme(ctx,input);assert.ok('token' in result);return result;}
async function apply(ctx:AuthorizedContext,input:StarterPlan,token:string){const result=await planStarterProgramme(ctx,{...input,token,confirm:true},true);assert.ok('id' in result);return result;}

test('starter programme preview, concurrent adoption and replay keep one owned task set through real generic completion',async()=>{
 const f=await setup(),{owner,reviewer,editor,viewer,foreign}=f,input=plan(editor.userId);
 try{
  const empty=await starterProgrammeWorkspace(owner);assert.deepEqual(empty.packs.map(p=>p.id),['business-foundations','people-access','supplier-continuity','nhs-digital-health-england','soc2-iso27001','uk-gdp-cold-chain','uk-gmp-site-validation','nist-csf-2','iso27001-annex-a','cyber-essentials','uk-gdpr-accountability','uk-gdp-self-inspection','soc2-security','nist-800-53b-low','nist-800-53b-moderate','nist-800-53b-high','nist-800-53b-privacy','soc2-iso27001-joint']);assert.equal(empty.programmes.length,0);assert.equal(empty.programmesLimited,false);assert.equal(empty.members.length,3);
  const proposed=await preview(owner,input);assert.equal(proposed.total,2);assert.equal(await db.obligation.count({where:{organizationId:owner.organizationId}}),0);assert.equal(await db.auditEvent.count({where:{organizationId:owner.organizationId}}),0,'preview records no tasks or audit events');
  await assert.rejects(()=>preview(editor,input),(error:any)=>error.status===403);await assert.rejects(()=>preview(viewer,input),(error:any)=>error.status===403);
  await assert.rejects(()=>preview(owner,{...input,items:[{...input.items[0],assigneeId:foreign.userId}]}),(error:any)=>error.status===409);
  await assert.rejects(()=>preview(owner,{...input,items:[{...input.items[0],assigneeId:viewer.userId}]}),(error:any)=>error.status===409);
  await assert.rejects(()=>apply(owner,input,'0'.repeat(64)),(error:any)=>error.status===409);
  await assert.rejects(()=>apply(owner,{...input,items:[{...input.items[0],title:'Changed after the initial preview'},input.items[1]]},proposed.token),(error:any)=>error.status===409);
  await db.membership.update({where:{organizationId_userId:{organizationId:owner.organizationId,userId:editor.userId}},data:{role:'ADMIN'}});
  await assert.rejects(()=>apply(owner,input,proposed.token),(error:any)=>error.status===409,'a changed owner role invalidates the preview even when it remains eligible');
  await db.membership.update({where:{organizationId_userId:{organizationId:owner.organizationId,userId:editor.userId}},data:{role:'EDITOR'}});
  const concurrent=await Promise.all([apply(owner,input,proposed.token),apply(owner,input,proposed.token)]);assert.equal(new Set(concurrent.map(result=>result.id)).size,1);assert.equal(concurrent.filter(result=>!result.reused).length,1);
  const created=concurrent[0],tasks=await db.obligation.findMany({where:{organizationId:owner.organizationId},orderBy:{id:'asc'}});assert.equal(tasks.length,2);assert.equal(tasks.every(task=>task.assigneeId===editor.userId&&task.status==='OPEN'&&task.originKey===null&&task.controlId===null&&task.connectorId===null),true);assert.equal(await db.auditEvent.count({where:{organizationId:owner.organizationId,action:'starter_programme.created'}}),1);
  const selected=await starterProgrammeWorkspace(owner,created.id);assert.equal(selected.selected?.total,2);assert.equal(selected.selected?.completed,0);assert.equal(selected.selected?.items.every(item=>item.task&&new URL(item.task.href,'https://example.invalid').searchParams.get('taskId')===item.task.id),true);assert.doesNotMatch(JSON.stringify(selected),/previewToken|requestHash|automationKey|storageKey/);
  await assert.rejects(()=>starterProgrammeWorkspace(foreign,created.id),(error:any)=>error.status===404);await assert.rejects(()=>starterProgrammeWorkspace({...foreign,organizationId:owner.organizationId},created.id),(error:any)=>error.status===403);
  const objects=new Map<string,Uint8Array>(),storage:EvidenceObjectStore={async put(key,bytes){objects.set(key,Uint8Array.from(bytes));},async get(key){const bytes=objects.get(key);if(!bytes)throw new Error('Missing fictional proof');return Uint8Array.from(bytes);},async remove(key){objects.delete(key);}},notes='The fictional operating scope, responsibilities and supporting record were independently checked.';
  const taskId=created.taskIds[0],evidence=await createEvidence(editor,taskId,'fictional-programme-record.pdf',fixturePdf([['FICTIONAL BUSINESS RECORD','This fictional record describes the task outcome and the responsible people.']]),{storage,scan:async()=>({status:'CLEAN',engine:'fictional-test'})});
  assert.deepEqual((await starterProgrammeWorkspace(owner,created.id)).selected!.items[0].reviewedFiles,[]);
  assert.equal((await workCompletion(editor,taskId)).ready,false,'starter adoption never bypasses file review');
  await reviewEvidence(reviewer,evidence.id,{decision:'APPROVED',version:1,notes},storage);const completion=await workCompletion(editor,taskId);assert.equal(completion.ready,true);await completeWork(editor,taskId,{token:completion.token!,evidenceIds:completion.evidence.map(file=>file.id),notes,confirm:true},{storage});
  const refs=(await starterProgrammeWorkspace(owner,created.id)).selected!.items[0].reviewedFiles!;
  assert.equal(refs[0].id,evidence.id);assert.match(refs[0].sha256,/^[0-9a-f]{64}$/);assert.equal((await starterProgrammeWorkspace(viewer,created.id)).selected!.items[0].reviewedFiles,undefined);
  const before=await db.obligation.findUniqueOrThrow({where:{id:taskId}}),replayed=await apply(owner,input,proposed.token),after=await db.obligation.findUniqueOrThrow({where:{id:taskId}});assert.equal(replayed.reused,true);assert.equal(after.status,'COMPLETE');assert.equal(after.updatedAt.toISOString(),before.updatedAt.toISOString());assert.equal((await starterProgrammeWorkspace(owner,created.id)).selected?.completed,1,'the saved programme resumes live task progress');
  await assert.rejects(()=>apply(owner,{...input,name:'Different saved programme name'},proposed.token),(error:any)=>error.status===409);assert.equal(await db.obligation.count({where:{organizationId:owner.organizationId}}),2);
  const changed=plan(editor.userId,STARTER_PACKS[1]),another={...changed,name:'A competing fictional people plan'},[first,second]=await Promise.all([preview(owner,changed),preview(owner,another)]),race=await Promise.allSettled([apply(owner,changed,first.token),apply(owner,another,second.token)]);assert.equal(race.filter(result=>result.status==='fulfilled').length,1);assert.equal(race.filter(result=>result.status==='rejected').length,1);assert.equal(await db.obligation.count({where:{organizationId:owner.organizationId}}),4,'different concurrent plans cannot create duplicate pack tasks');
  await db.membership.update({where:{organizationId_userId:{organizationId:owner.organizationId,userId:owner.userId}},data:{role:'VIEWER'}});await assert.rejects(()=>apply(owner,input,proposed.token),(error:any)=>error.status===403);assert.equal((await starterProgrammeWorkspace(owner)).canCreate,false,'current membership overrides a stale caller role');
 }finally{await f.clean();}
});

test('starter programme creation rolls back atomically and invalid history cannot masquerade as a saved programme',async()=>{
 const f=await setup(),{owner,editor}=f,input=plan(editor.userId,STARTER_PACKS[2]);let trigger=false;
 try{
  input.items[1].title='Fictional starter rollback sentinel';const proposed=await preview(owner,input);
  await db.$executeRawUnsafe(`CREATE FUNCTION public.regpilot_test_starter_rollback() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.title='Fictional starter rollback sentinel' THEN RAISE EXCEPTION 'Fictional starter rollback'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER regpilot_test_starter_rollback BEFORE INSERT ON public."Obligation" FOR EACH ROW EXECUTE FUNCTION public.regpilot_test_starter_rollback()');trigger=true;
  await assert.rejects(()=>apply(owner,input,proposed.token));assert.equal(await db.obligation.count({where:{organizationId:owner.organizationId}}),0);assert.equal(await db.auditEvent.count({where:{organizationId:owner.organizationId}}),0,'failure on the second task leaves neither a partial task set nor an adoption record');
  await db.$executeRawUnsafe('DROP TRIGGER regpilot_test_starter_rollback ON public."Obligation"');trigger=false;await db.$executeRawUnsafe('DROP FUNCTION public.regpilot_test_starter_rollback()');
  const created=await apply(owner,input,proposed.token),event=await db.auditEvent.findUniqueOrThrow({where:{id:created.id}}),details=event.details as Record<string,any>;
  await db.auditEvent.update({where:{id:event.id},data:{details:{...details,recordHash:'0'.repeat(64)}}});await assert.rejects(()=>starterProgrammeWorkspace(owner,event.id),(error:any)=>error.status===409);await assert.rejects(()=>apply(owner,input,proposed.token),(error:any)=>error.status===409);assert.equal(await db.obligation.count({where:{organizationId:owner.organizationId}}),2,'invalid history cannot trigger replacement tasks');
  await db.auditEvent.update({where:{id:event.id},data:{details:event.details!}});
  await db.obligation.update({where:{id:created.taskIds[0]},data:{assigneeId:null,ownerName:'Unassigned',dueDate:new Date(Date.now()-2*86400000)}});const open=await starterProgrammeWorkspace(owner,event.id);assert.equal(open.selected?.needsAttention,1);assert.equal(open.selected?.items[0].attention.length,2,'live owner/date issues remain visible while the original plan is retained');
  await db.obligation.update({where:{id:created.taskIds[1]},data:{automationKey:null}});const broken=await starterProgrammeWorkspace(owner,event.id);assert.equal(broken.selected?.needsAttention,2);assert.equal(broken.selected?.items[1].task,null,'a mismatched task identity is not silently treated as complete');
 }finally{if(trigger)await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS regpilot_test_starter_rollback ON public."Obligation"');await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS public.regpilot_test_starter_rollback()');await f.clean();await db.$disconnect();}
});

test('a mapped evidence task is shared by both audit references in the saved programme and export',async()=>{
 const {programmeMappingCsv}=await import('../lib/programme-mapping');
 const f=await setup();
 try{
  const pack=STARTER_PACKS.find(p=>p.id==='soc2-iso27001')!,input=plan(f.editor.userId,pack),previewed=await preview(f.owner,input);
  assert.equal(previewed.items[0].mappings?.length,2);
  const saved=await apply(f.owner,input,previewed.token),view=(await starterProgrammeWorkspace(f.owner,saved.id)).selected!;
  const csv=programmeMappingCsv(view),rows=csv.split('\r\n');
  assert.equal(rows.length,5);assert.ok(rows[1].includes(saved.taskIds[0])&&rows[2].includes(saved.taskIds[0]));
  assert.ok(rows[1].includes('SOC 2 Security')&&rows[2].includes('ISO/IEC 27001:2022'));
  const task=await db.obligation.findFirstOrThrow({where:{id:saved.taskIds[0],organizationId:f.owner.organizationId}});
  assert.ok(task.notes?.includes('CC6.2')&&task.notes.includes('A.5.18'));assert.equal(task.status,'OPEN');assert.equal(task.sourceUrl,pack.items[0].sourceUrl);assert.equal(view.items[0].sourceUrl,task.sourceUrl);

  const nist=STARTER_PACKS.find(p=>p.id==='nist-csf-2')!,nistPlan=plan(f.editor.userId,nist);
  const {assigneeId,dueDate}=nistPlan.items[0];
  nistPlan.items=nist.items.map(({key,title,why,description})=>({key,title,why,description,assigneeId,dueDate}));
  const nistPreview=await preview(f.owner,nistPlan),adopted=await apply(f.owner,nistPlan,nistPreview.token);
  const selected=(await starterProgrammeWorkspace(f.owner,adopted.id)).selected!;
  assert.equal(new Set(adopted.taskIds).size,22);
  assert.equal(new Set(selected.items.flatMap(item=>item.mappings??[])).size,106);
  assert.equal(programmeMappingCsv(selected).split('\r\n').length,107);
  const iso=STARTER_PACKS.find(p=>p.id==='iso27001-annex-a')!,isoPlan=plan(f.editor.userId,iso);
  const ip=await preview(f.owner,isoPlan),isoSaved=await apply(f.owner,isoPlan,ip.token);
  const {programmeReferenceStatement,decideProgrammeReference}=await import('../lib/server/programme-reference-review');
  const {referenceStatementCsv}=await import('../lib/programme-reference-csv');
  const all=await programmeReferenceStatement(f.owner,isoSaved.id);
  assert.equal(all.rows.length,93);assert.ok(all.rows.some(r=>!r.taskId));assert.ok(all.rows.every(r=>r.decision==='UNASSESSED'));
  const reference=all.rows[0].reference,choice={recordHash:all.recordHash,reference,version:0,decision:'APPLIES',reason:'This reference applies to permissions exercised by the site security team.'};
  await Promise.all([decideProgrammeReference(f.owner,isoSaved.id,choice),decideProgrammeReference(f.owner,isoSaved.id,choice)]);
  await assert.rejects(()=>decideProgrammeReference(f.reviewer,isoSaved.id,{...choice,decision:'EXCLUDED'}),(e:any)=>e.status===409);
  await assert.rejects(()=>programmeReferenceStatement(f.foreign,isoSaved.id),(e:any)=>e.status===404);
  await assert.rejects(()=>programmeReferenceStatement(f.viewer,isoSaved.id),(e:any)=>e.status===403);
  await decideProgrammeReference(f.reviewer,isoSaved.id,{...choice,version:1,decision:'REVIEW_NEEDED',reason:'Ownership has changed and the original decision now requires another review.'});
  const final=await programmeReferenceStatement(f.reviewer,isoSaved.id);
  assert.equal(final.rows[0].version,2);assert.equal(final.rows[0].reviewerId,f.reviewer.userId);
  const {programmeCrosswalk}=await import('../lib/server/programme-reference-review'),{crosswalkCsv}=await import('../lib/programme-crosswalk');
  const stored=new Map<string,Uint8Array>(),storage:EvidenceObjectStore={async put(k,v){stored.set(k,Uint8Array.from(v));},async get(k){return stored.get(k)!;},async remove(k){stored.delete(k);}};
  const evidence=await createEvidence(f.editor,saved.taskIds[0],'access-sample.pdf',fixturePdf([['Approved access sample']]),{storage,scan:async()=>({status:'CLEAN',engine:'fictional-test'})});
  let cross=await programmeCrosswalk(f.reviewer,isoSaved.id,saved.id);
  assert.equal(cross.rows.length,93);assert.equal(cross.shared,4);assert.equal(cross.reviewedFiles,0);
  await reviewEvidence(f.reviewer,evidence.id,{decision:'APPROVED',version:1,notes:'The fictional access sample was reviewed independently against the recorded task and scope.'},storage);
  cross=await programmeCrosswalk(f.reviewer,isoSaved.id,saved.id);
  assert.equal(cross.reviewedFiles,1);assert.equal(cross.rows[0].decision,'REVIEW_NEEDED');
  for(const code of ['A.5.16','A.5.18'])assert.equal(cross.rows.find(row=>row.code===code)!.tasks.find(link=>link.criteria.includes('CC6.2'))!.files[0].id,evidence.id);
  assert.match(crosswalkCsv(cross),new RegExp(evidence.id));
  await assert.rejects(programmeCrosswalk(f.viewer,isoSaved.id,saved.id),(err:any)=>err.status===403);
  await assert.rejects(programmeCrosswalk(f.foreign,isoSaved.id,saved.id),(err:any)=>err.status===404);
  const high=plan(f.editor.userId,STARTER_PACKS.find(p=>p.id==='nist-800-53b-high')!);
  const highSaved=await apply(f.owner,high,(await preview(f.owner,high)).token);
  const highScope=await programmeReferenceStatement(f.owner,highSaved.id);
  assert.equal(highScope.rows.length,370);assert.ok(highScope.rows.some(r=>r.area==='Automated System Account Management'&&r.taskId));
  assert.ok(highScope.rows.some(r=>!r.taskId));assert.equal(referenceStatementCsv(highScope).split('\r\n').length,371);
  const socPack=STARTER_PACKS.find(p=>p.id==='soc2-security')!,soc=plan(f.editor.userId,socPack);
  soc.items=socPack.items.map(({key,title,why,description})=>({key,title,why,description,assigneeId,dueDate}));
  const socId=(await apply(f.owner,soc,(await preview(f.owner,soc)).token)).id,security=await programmeReferenceStatement(f.owner,socId);
  assert.equal(security.rows.filter(r=>r.reference.startsWith('SOC 2 Security')).length,33);
  const fullCross=await programmeCrosswalk(f.reviewer,isoSaved.id,socId);
  assert.ok(fullCross.rows.some(r=>r.code==='A.8.32'&&r.tasks.some(t=>t.criteria.includes('CC8.1'))));
  const jointPack=STARTER_PACKS.find(p=>p.id==='soc2-iso27001-joint')!,joint=plan(f.editor.userId,jointPack);
  joint.items=jointPack.items.map(({key,title,why,description})=>({key,title,why,description,assigneeId,dueDate}));
  const confirmation=(await preview(f.owner,joint)).token,jointResult=await apply(f.owner,joint,confirmation);
  assert.equal(new Set(jointResult.taskIds).size,24);
  assert.deepEqual((await apply(f.owner,joint,confirmation)).taskIds,jointResult.taskIds);
  const statement=await programmeReferenceStatement(f.owner,jointResult.id);
  assert.equal(statement.rows.filter(r=>r.reference.includes(' · CC')).length,33);
  assert.equal(statement.rows.filter(r=>r.reference.includes(' · A.')).length,93);
  assert.equal(statement.rows.filter(r=>r.reference.includes(' · Clause ')).length,30);
  const shared=statement.rows.find(r=>r.reference.endsWith(' · CC6.2'))!;
  assert.equal(statement.rows.find(r=>r.reference.endsWith(' · A.5.16'))!.taskId,shared.taskId);
  assert.ok(shared.taskId);
  const sample=await createEvidence(f.editor,shared.taskId,'joint-access.pdf',fixturePdf([['Joint access sample']]),{storage,scan:async()=>({status:'CLEAN',engine:'fictional-test'})});
  await reviewEvidence(f.reviewer,sample.id,{decision:'APPROVED',version:1,notes:'The independent reviewer traced the access sample to the shared task and its source.'},storage);
  const reviewed=await programmeReferenceStatement(f.reviewer,jointResult.id);
  assert.deepEqual(reviewed.rows.find(r=>r.reference.endsWith(' · CC6.2'))!.reviewedFiles,reviewed.rows.find(r=>r.reference.endsWith(' · A.5.16'))!.reviewedFiles);
  assert.ok(reviewed.rows.find(r=>r.reference===shared.reference)!.reviewedFiles.some(value=>value.startsWith(sample.id+' @ ')));
  await decideProgrammeReference(f.reviewer,jointResult.id,{...choice,recordHash:statement.recordHash,reference:shared.reference});
  const {referenceEvidence,referenceEvidenceCsv}=await import('../lib/programme-reference-csv');
  const scoped=await programmeReferenceStatement(f.reviewer,jointResult.id),applied=scoped.rows.find(r=>r.reference===shared.reference)!;
  assert.equal(referenceEvidence(applied,false),'covered');assert.ok(applied.tasks.some(t=>t.href.includes('taskId=')&&t.reviewedFiles.length));
  assert.equal(referenceEvidence({...applied,tasks:[]},false),'unlinked');
  const incomplete={...applied,tasks:[...applied.tasks,{...applied.tasks[0],reviewedFiles:[]}]};
  assert.equal(referenceEvidence(incomplete,false),'missing');assert.equal(referenceEvidence(incomplete,true),'limited');
  assert.match(referenceEvidenceCsv(scoped,[applied]),new RegExp(sample.id));
  const exportRows=referenceStatementCsv(await programmeReferenceStatement(f.reviewer,jointResult.id)).split('\r\n');
  assert.equal(exportRows.length,157);assert.match(exportRows.find(row=>row.includes(' · CC6.2'))!,/APPLIES/);assert.match(exportRows.find(row=>row.includes(' · A.5.16'))!,/UNASSESSED/);
  assert.match(referenceStatementCsv(final),/REVIEW_NEEDED/);assert.equal(referenceStatementCsv(final).split('\r\n').length,94);
 }finally{await f.clean();}
});
