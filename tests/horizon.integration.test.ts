import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {db} from '../lib/server/db';
import {changeHorizonWatchlist} from '../lib/server/horizon-watchlists';
import {emptyHorizonView, MAX_WATCHLISTS} from '../lib/horizon/watchlists';
import {assuranceFixture, rejects} from './helpers/assurance-fixture';
import {triageHorizon,horizonWorkspace} from '../lib/server/horizon-service';
import {PUBLISHERS,type HorizonReport} from '../lib/horizon/model';
import type {AuthorizedContext} from '../lib/server/authorization';
test('horizon review is tenant-scoped, assigned, revision-bound, idempotent and cannot turn metadata into a compliance verdict',async()=>{
 const marker=randomUUID(),users=await Promise.all(['a','b','viewer'].map(n=>db.user.create({data:{externalId:n+marker,email:n+marker+'@example.invalid'}}))),orgs=await Promise.all(['a','b'].map(n=>db.organization.create({data:{name:'Fictional horizon '+n+marker}})));
 const old=process.env.REGPILOT_AI_ALLOWED_EMAILS;process.env.REGPILOT_AI_ALLOWED_EMAILS=users.map(u=>u.email).join(',');
 const ctx:AuthorizedContext={organizationId:orgs[0].id,userId:users[0].id,role:'OWNER'},other:AuthorizedContext={organizationId:orgs[1].id,userId:users[1].id,role:'OWNER'};
 const date=new Date().toISOString(),report:HorizonReport={format:'regpilot-horizon-v1',generatedAt:date,windowStart:new Date(Date.now()-30*86400000).toISOString(),codeCommit:null,runId:null,previousAvailable:false,feeds:PUBLISHERS.map(p=>({id:p.id,state:'available',checkedAt:date,total:1,retrieved:1,reason:null})),items:[{id:'a'.repeat(32),revision:'b'.repeat(32),path:'/guidance/fictional-horizon',url:'https://www.gov.uk/guidance/fictional-horizon',title:'Fictional horizon publication',summary:'Fixture only.',documentType:'detailed_guide',kind:'Guidance',publisherIds:['mhra'],updatedAt:date,observedAt:date,firstSeenAt:date,discovery:'BASELINE'}],limitations:[]};
 const input={itemId:report.items[0].id,revision:report.items[0].revision,action:'queue',notes:'Assess this fictional publication for local relevance.',reviewAcknowledged:true,ownerId:users[0].id,dueDate:new Date(Date.now()+7*86400000).toISOString().slice(0,10)};
 try{
  await db.membership.createMany({data:[{organizationId:ctx.organizationId,userId:ctx.userId,role:'OWNER'},{organizationId:other.organizationId,userId:other.userId,role:'OWNER'},{organizationId:ctx.organizationId,userId:users[2].id,role:'VIEWER'}]});
  await assert.rejects(()=>triageHorizon({...ctx,userId:users[2].id,role:'OWNER'},input,async()=>report),(e:any)=>e.status===403);
  await assert.rejects(()=>triageHorizon(ctx,{...input,ownerId:users[1].id},async()=>report),(e:any)=>e.status===409);
  await assert.rejects(()=>triageHorizon(ctx,{...input,revision:'c'.repeat(32)},async()=>report),(e:any)=>e.status===409);
  await assert.rejects(()=>triageHorizon(ctx,input,async()=>({...report,generatedAt:new Date(Date.now()-13*3600000).toISOString(),items:[]})),(e:any)=>!!e);
  const watch={action:'save',id:randomUUID(),version:0,name:'Medicines queue',filters:{...emptyHorizonView,publisher:'mhra',phrases:['gmp']}};
  await changeHorizonWatchlist(ctx,watch);
  const triageFrom=(version:number,id=watch.id)=>triageHorizon(ctx,{...input,watchlist:{id,version}},async()=>report);
  await assert.rejects(()=>triageFrom(1),rejects(409));
  const updated=await changeHorizonWatchlist(ctx,{...watch,version:1,filters:{...watch.filters,phrases:['fictional horizon']}});
  await assert.rejects(()=>triageFrom(1),rejects(409));
  await assert.rejects(()=>triageFrom(2,randomUUID()),rejects(409));
  const results=await Promise.all([triageFrom(updated.version),triageFrom(updated.version)]);
  assert.equal(results[0].taskId,results[1].taskId);assert.equal(results.filter(r=>r.reused).length,1);
  const task=await db.obligation.findUniqueOrThrow({where:{id:results[0].taskId!}});assert.equal(task.assigneeId,ctx.userId);assert.equal(task.status,'OPEN');assert.equal(task.sourceCheckedAt,null);assert.match(task.notes,/not a verified legal obligation/);
  assert.match(task.notes,/Medicines queue \(version 2\) · Matched “fictional horizon”/);
  await changeHorizonWatchlist(ctx,{action:'archive',id:watch.id,version:2});
  assert.equal((await triageFrom(2)).reused,true);
  const forensic=await db.auditEvent.findFirstOrThrow({where:{organizationId:ctx.organizationId,action:'horizon.review_queued'}});
  assert.deepEqual((forensic.details as any).watchlist,{id:watch.id,name:watch.name,version:2,filters:updated.filters,matchedPhrase:'fictional horizon'});
  assert.equal((await horizonWorkspace(other)).decisions.length,0);assert.equal((await horizonWorkspace(ctx)).decisions.length,1);
  await assert.rejects(()=>triageHorizon(ctx,{...input,action:'dismiss'},async()=>report),(e:any)=>e.status===409);
  const revised={...report,items:[{...report.items[0],revision:'c'.repeat(32)}]};
  await triageHorizon(ctx,{...input,revision:'c'.repeat(32),action:'dismiss'},async()=>revised);assert.equal(await db.obligation.count({where:{organizationId:ctx.organizationId}}),1);
  const queued=await triageHorizon(ctx,{...input,revision:'c'.repeat(32)},async()=>revised);assert.equal(queued.reused,false);assert.equal(await db.obligation.count({where:{organizationId:ctx.organizationId}}),2);
  assert.equal(await db.regulatorySnapshot.count({where:{organizationId:ctx.organizationId}}),0,'metadata triage cannot fabricate reviewed source text');
 }finally{
  const ids=orgs.map(o=>o.id);await db.auditEvent.deleteMany({where:{organizationId:{in:ids}}});await db.obligation.deleteMany({where:{organizationId:{in:ids}}});await db.membership.deleteMany({where:{organizationId:{in:ids}}});await db.organization.deleteMany({where:{id:{in:ids}}});await db.user.deleteMany({where:{id:{in:users.map(u=>u.id)}}});if(old===undefined)delete process.env.REGPILOT_AI_ALLOWED_EMAILS;else process.env.REGPILOT_AI_ALLOWED_EMAILS=old;
 }
});

test('shared horizon watchlists enforce tenant membership, versioned edits, replay and the active quota', async () => {
 const priorEmails = process.env.REGPILOT_AI_ALLOWED_EMAILS;
 const x = await assuranceFixture();
 const watch = {action:'save', id:randomUUID(), version:0, name:'Medicines this week',
   filters:{...emptyHorizonView, publisher:'mhra', topic:'medicines', phrases:['GMP'], updatedWithin:'week'}};
 try {
   for (const actor of [x.st,x.ed,{...x.out,organizationId:x.a.id}]) {
     await assert.rejects(()=>changeHorizonWatchlist({...actor,role:'OWNER'},watch),rejects(403));
   }
   const [created,replay] = await Promise.all([changeHorizonWatchlist(x.o,watch),changeHorizonWatchlist(x.o,watch)]);
   assert.deepEqual(created,replay);
   assert.equal(created.version,1);
   assert.deepEqual(created.filters.phrases,['gmp']);
   assert.deepEqual((await horizonWorkspace(x.st)).watchlists,[created]);
   assert.deepEqual((await horizonWorkspace(x.out)).watchlists,[]);
   await assert.rejects(()=>changeHorizonWatchlist(x.out,{...watch,version:1}),rejects(404));
   await changeHorizonWatchlist(x.out,watch);
   await assert.rejects(()=>changeHorizonWatchlist(x.ad,{...watch,id:randomUUID(),name:watch.name.toUpperCase()}),rejects(409));
   const edits=await Promise.allSettled(['Review A','Review B'].map(name=>changeHorizonWatchlist(x.ad,{...watch,version:1,name})));
   assert.equal(edits.filter(r=>r.status==='fulfilled').length,1);
   assert.ok(edits.some(r=>r.status==='rejected' && r.reason.status===409));
   const current=(await horizonWorkspace(x.ed)).watchlists[0];
   assert.equal(current.version,2);
   assert.deepEqual(await changeHorizonWatchlist(x.ad,{...watch,version:1,name:current.name}),current);
   const archive={id:watch.id,action:'archive',version:current.version};
   const archived=await changeHorizonWatchlist(x.o,archive);
   assert.ok(archived.archived);
   assert.deepEqual(await changeHorizonWatchlist(x.o,archive),archived);
   assert.deepEqual((await horizonWorkspace(x.st)).watchlists,[]);
   assert.equal((await horizonWorkspace(x.out)).watchlists[0].version,1);
   assert.equal(await db.auditEvent.count({where:{organizationId:x.a.id,entityType:'HorizonWatchlist',entityId:watch.id}}),3);
   assert.equal(await db.obligation.count({where:{organizationId:x.a.id}}),1);
   await db.horizonWatchlist.createMany({data:Array.from({length:MAX_WATCHLISTS-1},(_,i)=>({
     id:randomUUID(),organizationId:x.a.id,name:'Capacity '+i,filters:emptyHorizonView,changedById:x.o.userId,
   }))});
   const finalSlot=await Promise.allSettled(['Final A','Final B'].map(name=>changeHorizonWatchlist(x.o,{...watch,id:randomUUID(),name})));
   assert.equal(finalSlot.filter(r=>r.status==='fulfilled').length,1);
   assert.ok(finalSlot.some(r=>r.status==='rejected' && r.reason.status===409));
   assert.equal((await horizonWorkspace(x.o)).watchlists.length,MAX_WATCHLISTS);
 } finally {
   try { await x.cleanup(); } finally {
     if(priorEmails===undefined)delete process.env.REGPILOT_AI_ALLOWED_EMAILS;else process.env.REGPILOT_AI_ALLOWED_EMAILS=priorEmails;
   }
 }
});
