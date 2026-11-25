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
  const empty=await starterProgrammeWorkspace(owner);assert.deepEqual(empty.packs.map(p=>p.id),['business-foundations','people-access','supplier-continuity','nhs-digital-health-england','soc2-iso27001','uk-gdp-cold-chain','uk-gmp-site-validation']);assert.equal(empty.programmes.length,0);assert.equal(empty.programmesLimited,false);assert.equal(empty.members.length,3);
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
  assert.equal((await workCompletion(editor,taskId)).ready,false,'starter adoption never bypasses file review');
  await reviewEvidence(reviewer,evidence.id,{decision:'APPROVED',version:1,notes},storage);const completion=await workCompletion(editor,taskId);assert.equal(completion.ready,true);await completeWork(editor,taskId,{token:completion.token!,evidenceIds:completion.evidence.map(file=>file.id),notes,confirm:true},{storage});
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
  assert.ok(task.notes?.includes('CC6.2')&&task.notes.includes('A.5.18'));assert.equal(task.status,'OPEN');
 }finally{await f.clean();}
});
