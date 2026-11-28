import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {inventoryAction,inventoryWorkspace} from "../lib/server/ai-inventory-service";
import {searchWorkspaceRecords} from "../lib/server/workspace-record-search";
import {db} from "../lib/server/db";
import {assuranceFixture, future, rejects} from "./helpers/assurance-fixture";

const profile = {purpose:"Draft and summarise fictional quality procedures.",safeguards:"A qualified person approves every release.",dataClass:"SENSITIVE",access:"DRAFT",impact:"HEALTH"};
const fields=(ownerId:string)=>({name:"Fictional quality assistant",kind:"AGENT",ownerId,vendorId:null,controlId:null,profile});
const review=(id:string,version:number,evidenceId:string)=>({action:"DECIDE",id,version,evidenceId,verdict:"RESTRICTED",validUntil:future(),rationale:"Restrict use to reviewed drafts with an accountable editor."});
const model=(reference:string,version:string)=>({type:"machine-learning-model","bom-ref":reference,name:"Fictional model "+reference,version});

test("AI uses bind independent decisions to current evidence, ownership and version across tenant boundaries",async()=>{
  const f=await assuranceFixture();
  try {
    const input={action:"CREATE",requestKey:randomUUID(),...fields(f.ed.userId)};
    await assert.rejects(()=>inventoryAction(f.st,input),rejects(403));
    await assert.rejects(()=>inventoryAction(f.ed,{...input,ownerId:f.out.userId}),rejects(409));
    await assert.rejects(()=>inventoryAction(f.ed,{...input,controlId:randomUUID()}),rejects(409));
    const created=await Promise.all([inventoryAction(f.ed,input),inventoryAction(f.ed,input)]);
    assert.equal(await db.aiSystem.count({where:{organizationId:f.a.id}}),1);
    const row=(await inventoryWorkspace(f.ed)).systems[0];
    assert.ok(created.every(r=>"id" in r && r.id===row.id));
    assert.equal(row.assessment.priority,"High");assert.equal(row.status,"Awaiting review");
    await assert.rejects(()=>inventoryAction(f.ed,{...input,name:"Changed request"}),rejects(409));
    assert.equal((await inventoryWorkspace(f.out)).systems.length,0);
    const terms=await db.$transaction(tx=>searchWorkspaceRecords(tx,f.a.id,"fictional quality assistant"));
    assert.ok(terms.some(r=>r.kind==="AI system" && r.href.includes("systemId="+row.id)));
    assert.equal((await db.$transaction(tx=>searchWorkspaceRecords(tx,f.b.id,"fictional quality assistant"))).length,0);
    await assert.rejects(()=>inventoryWorkspace({...f.out,organizationId:f.a.id}),rejects(403));
    const file=await f.file(), decision=review(row.id,row.version,file.id);
    await assert.rejects(()=>inventoryAction(f.out,decision,f.store),rejects(404));
    await assert.rejects(()=>inventoryAction(f.ed,decision,f.store),rejects(403));
    const original=(await db.evidence.findUniqueOrThrow({where:{id:file.id}})).storageKey;
    const bytes=await f.store.get(original);await f.store.put(original,Uint8Array.of(1,2,3),"application/pdf");
    await assert.rejects(()=>inventoryAction(f.o,decision,f.store));await f.store.put(original,bytes,"application/pdf");
    assert.equal(await db.aiSystemDecision.count({where:{systemId:row.id}}),0);
    await Promise.all([inventoryAction(f.o,decision,f.store),inventoryAction(f.o,decision,f.store)]);
    assert.equal(await db.aiSystemDecision.count({where:{systemId:row.id}}),1);
    assert.equal((await inventoryWorkspace(f.o)).systems[0].status,"Restricted");
    await assert.rejects(()=>inventoryAction(f.o,{...decision,verdict:"APPROVED"},f.store),rejects(409));
    await db.evidence.update({where:{id:file.id},data:{scanStatus:"QUARANTINED"}});
    assert.equal((await inventoryWorkspace(f.o)).systems[0].status,"Review invalidated");
    await db.evidence.update({where:{id:file.id},data:{scanStatus:"CLEAN"}});
    await db.membership.update({where:{organizationId_userId:{organizationId:f.a.id,userId:f.ed.userId}},data:{role:"VIEWER"}});
    assert.equal((await inventoryWorkspace(f.o)).systems[0].status,"Review invalidated");
    await db.membership.update({where:{organizationId_userId:{organizationId:f.a.id,userId:f.ed.userId}},data:{role:"EDITOR"}});
    const update={action:"UPDATE",id:row.id,version:row.version,...fields(f.o.userId)};
    await inventoryAction(f.o,update);
    await assert.rejects(()=>inventoryAction(f.o,update),rejects(409));
    const next=(await inventoryWorkspace(f.o)).systems[0];assert.equal(next.status,"Awaiting review");assert.equal(next.history[0].version,1);
    await assert.rejects(()=>inventoryAction(f.o,review(row.id,next.version,file.id),f.store),rejects(403));
    const clean=JSON.stringify(await inventoryWorkspace(f.o));assert.doesNotMatch(clean,/storageKey|contextHash/);
  } finally {await f.cleanup();}
});

test("BOM preview, selective import, replay protection and change detection operate on actual records",async()=>{
  const f=await assuranceFixture(),serial="urn:uuid:"+randomUUID();
  const bom=(version:number,models:object[])=>({bomFormat:"CycloneDX",specVersion:"1.7",serialNumber:serial,version,components:[{type:"application",name:"Demo application",components:models}]});
  const a=model("a","1"),b=model("b","1"),first=bom(1,[a,b]);
  try {
    const preview=await inventoryAction(f.ed,{action:"PREVIEW",bom:first});
    assert.ok("candidates" in preview && preview.candidates?.length===2);
    assert.equal((await inventoryWorkspace(f.ed)).systems.length,0);
    assert.deepEqual(await inventoryAction(f.ed,{action:"IMPORT",bom:first,refs:["a"]}),{changed:1,unchanged:0});
    assert.deepEqual(await inventoryAction(f.ed,{action:"IMPORT",bom:first,refs:["a"]}),{changed:0,unchanged:1});
    let row=(await inventoryWorkspace(f.ed)).systems[0];assert.equal(row.status,"Needs assessment");
    const file=await f.file();
    await assert.rejects(()=>inventoryAction(f.o,review(row.id,row.version,file.id),f.store),rejects(409));
    await inventoryAction(f.ed,{action:"UPDATE",id:row.id,version:row.version,...fields(f.ed.userId),kind:"MODEL",name:a.name});
    row=(await inventoryWorkspace(f.ed)).systems[0];
    await inventoryAction(f.o,review(row.id,row.version,file.id),f.store);
    await assert.rejects(()=>inventoryAction(f.re,{action:"IMPORT",bom:bom(2,[b,a]),refs:["a"]}),rejects(403));
    await inventoryAction(f.ed,{action:"IMPORT",bom:bom(2,[b,a]),refs:["a"]});
    row=(await inventoryWorkspace(f.o)).systems[0];assert.equal(row.status,"Restricted");assert.equal(row.source?.version,2);
    await assert.rejects(()=>inventoryAction(f.ed,{action:"IMPORT",bom:first,refs:["b"]}),rejects(409));
    await assert.rejects(()=>inventoryAction(f.ed,{action:"IMPORT",bom:bom(2,[model("a","2"),b]),refs:["a","b"]}),rejects(409));
    assert.equal((await inventoryWorkspace(f.ed)).systems.length,1);
    const newer=bom(3,[model("a","2"),b]);await inventoryAction(f.ed,{action:"IMPORT",bom:newer,refs:["a","b"]});
    const rows=(await inventoryWorkspace(f.ed)).systems;
    assert.equal(rows.length,2);assert.equal(rows[0].id,row.id);assert.equal(rows[0].status,"Awaiting review");assert.equal(rows[0].history.length,1);
    assert.equal(rows[0].source?.modelVersion,"2");assert.equal(rows[1].status,"Needs assessment");
    assert.deepEqual(await inventoryAction(f.out,{action:"IMPORT",bom:first,refs:["a"]}),{changed:1,unchanged:0});
    assert.notEqual((await inventoryWorkspace(f.out)).systems[0].id,row.id);
  } finally {await f.cleanup();}
});
