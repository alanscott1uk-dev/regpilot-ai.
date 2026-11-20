import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {assuranceFixture,rejects} from "./helpers/assurance-fixture";
import {db} from "../lib/server/db";
import {changeAuditRoom,createAuditRoom,manageAuditRoom,guestAuditAction} from "../lib/server/auditor-service";
import {auditorFile,manageAuditorKey} from "../lib/server/auditor-api";
import {changeMember} from "../lib/server/team-service";
import {GET as sync} from "../app/api/v1/auditor/package/route";
import {GET as fileRoute} from "../app/api/v1/auditor/evidence/[id]/route";
import {GET as spec} from "../app/api/v1/auditor/openapi/route";

const request=(key?:string,etag?:string)=>new Request("https://pilot.invalid/api/v1/auditor/package",{headers:{
  ...(key?{Authorization:"Bearer "+key}:{}),...(etag?{"If-None-Match":etag}:{})}});
const configured=()=>Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:"true",REGPILOT_AUDITOR_API_ENABLED:"true",SUPABASE_URL:"https://auth.invalid",SUPABASE_PUBLISHABLE_KEY:"fictional"});
async function engagement(){
  const f=await assuranceFixture();configured();
  const file=await f.file();
  const room=await createAuditRoom(f.o,{title:"UK assurance review",purpose:"Review the independently approved, scoped evidence selection.",
    expiresAt:new Date(Date.now()+2*86400000).toISOString(),evidenceIds:[file.id]});
  const share=await changeAuditRoom(f.o,room.id,{action:"PUBLISH",version:room.version,manifestHash:room.manifestHash,acknowledgeDisclosure:true}) as {version:number};
  // The external reviewer has no membership in the disclosing organisation.
  const guest=await changeAuditRoom(f.o,room.id,{action:"INVITE",version:share.version,email:f.foreign.email}) as {id:string;version:number};
  const change=(action:"ISSUE"|"REVOKE",version:number,ctx=f.ad)=>manageAuditorKey(ctx,room.id,{action,grantId:guest.id,version});
  const accept=()=>guestAuditAction({externalId:f.foreign.externalId,email:f.foreign.email},guest.id,{action:"ACCEPT",version:guest.version});
  return {...f,sharedFile:file,room,guest,change,accept};
}
test("auditor API exports just the accepted grant, supports conditional sync, scoped byte reads and withdrawal",async()=>{
  const f=await engagement();try{
    assert.equal((await sync(request())).status,401);
    const denied=await fileRoute(request(),{params:Promise.resolve({id:"invalid"})});assert.equal(denied.status,401);
    await assert.rejects(()=>f.change("ISSUE",f.guest.version),rejects(409));
    await f.accept();const v=f.guest.version+1;
    await assert.rejects(()=>f.change("ISSUE",v,f.ed),rejects(403));
    await assert.rejects(()=>f.change("ISSUE",v,f.out),rejects(404));
    const issued=await f.change("ISSUE",v);assert.ok(issued.token);
    assert.equal(issued.expiresAt,f.room.expiresAt.toISOString());
    const row=await db.auditGrant.findUniqueOrThrow({where:{id:f.guest.id}});
    assert.match(row.apiKeyHash!,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(row).includes(issued.token));
    const first=await sync(request(issued.token));assert.equal(first.status,200);assert.match(first.headers.get("cache-control")!,/no-store/);
    const body=await first.json(),tag=first.headers.get("etag")!;
    assert.equal(body.evidence[0].id,f.sharedFile.id);assert.equal(body.evidence[0].sha256,f.sharedFile.sha256);
    assert.equal(body.selectionHash,f.room.manifestHash);assert.equal(body.evidence[0].state,"AVAILABLE");
    for(const priv of [f.owner.email,f.editor.email,f.foreign.email,"storageKey","organizationId","apiKeyHash",issued.token]){
      assert.ok(!JSON.stringify(body).includes(priv));
    }
    const unchanged=await sync(request(issued.token,"W/"+tag));
    assert.equal(unchanged.status,304);assert.equal(await unchanged.text(),"");
    const bytes=(await auditorFile(request(issued.token),f.sharedFile.id,f.store)).bytes;
    assert.equal(createHash("sha256").update(bytes).digest("hex"),f.sharedFile.sha256);
    const hidden=(await f.file()).id;
    await assert.rejects(()=>auditorFile(request(issued.token),hidden,f.store),rejects(404));
    assert.ok(!JSON.stringify(await manageAuditRoom(f.o,f.room.id)).includes(row.apiKeyHash!));
    await db.evidence.update({where:{id:f.sharedFile.id},data:{reviewVersion:{increment:1}}});
    const changed=await sync(request(issued.token,tag));
    assert.equal(changed.status,200);assert.notEqual(changed.headers.get("etag"),tag);
    assert.deepEqual((await changed.json()).evidence,[{id:f.sharedFile.id,state:"WITHDRAWN"}]);
    await assert.rejects(()=>auditorFile(request(issued.token),f.sharedFile.id,f.store),rejects(409));
    assert.equal(await db.membership.count({where:{userId:f.foreign.id,organizationId:f.a.id}}),0);
    const doc=await spec().json();assert.equal(doc.openapi,"3.1.0");assert.deepEqual(Object.keys(doc.paths).sort(),["/api/v1/auditor/evidence/{id}","/api/v1/auditor/package"]);
  }finally{await f.cleanup();}
});
test("replacing, expiring, disabling and revoking a named key are enforced even on cache hits and during object reads",async()=>{
  const f=await engagement();try{
    await f.accept();let version=f.guest.version+1;
    const first=await f.change("ISSUE",version++);assert.ok(first.token);
    await assert.rejects(()=>f.change("ISSUE",version-1),rejects(409));
    const next=await f.change("ISSUE",version++);assert.ok(next.token);assert.notEqual(next.token,first.token);
    assert.equal((await sync(request(first.token,"*"))).status,401);
    const oldEmail=process.env.REGPILOT_AI_ALLOWED_EMAILS!;
    process.env.REGPILOT_AI_ALLOWED_EMAILS=oldEmail.split(",").filter(email=>email!==f.foreign.email).join(",");
    assert.equal((await sync(request(next.token,"*"))).status,401);process.env.REGPILOT_AI_ALLOWED_EMAILS=oldEmail;
    await db.auditGrant.update({where:{id:f.guest.id},data:{apiExpiresAt:new Date(Date.now()-1000)}});
    assert.equal((await sync(request(next.token,"*"))).status,401);
    const third=await f.change("ISSUE",version++);assert.ok(third.token);
    process.env.REGPILOT_AUDITOR_API_ENABLED="false";
    assert.equal((await sync(request(third.token))).status,503);
    await f.change("REVOKE",version++);process.env.REGPILOT_AUDITOR_API_ENABLED="true";
    assert.equal((await sync(request(third.token))).status,401);
    const fourth=await f.change("ISSUE",version++);assert.ok(fourth.token);
    await assert.rejects(()=>auditorFile(request(fourth.token),f.sharedFile.id,{...f.store,async get(k){
      const bytes=await f.store.get(k);await f.change("REVOKE",version++);return bytes;
    }}),rejects(401));
    assert.equal(await db.auditEvent.count({where:{entityId:f.room.id,action:"auditor.api_file_downloaded"}}),0);
    const fifth=await f.change("ISSUE",version++);assert.ok(fifth.token);
    await changeMember(f.o,{action:"ROLE",userId:f.admin.id,expectedRole:"ADMIN",role:"EDITOR"});
    await changeMember(f.o,{action:"ROLE",userId:f.admin.id,expectedRole:"EDITOR",role:"ADMIN"});
    assert.equal((await sync(request(fifth.token,"*"))).status,401);
  }finally{process.env.REGPILOT_AUDITOR_API_ENABLED="true";await f.cleanup();}
});
test("a firm key cannot synchronise after room closure or bypass the durable rate budget",async()=>{
  const f=await engagement();try{
    await f.accept();const key=await f.change("ISSUE",f.guest.version+1);assert.ok(key.token);
    const slice=new Date(Math.floor(Date.now()/60000)*60000);
    await db.customerApiBudget.create({data:{organizationId:f.a.id,bucket:"auditor:"+f.guest.id,minute:slice,count:60}});
    const limit=await sync(request(key.token,"*"));assert.equal(limit.status,429);assert.ok(Number(limit.headers.get("retry-after"))>=1);
    const row=await db.auditRoom.findUniqueOrThrow({where:{id:f.room.id}});await changeAuditRoom(f.o,row.id,{action:"CLOSE",version:row.version});
    assert.equal((await sync(request(key.token,"*"))).status,401);
    assert.ok(!JSON.stringify(await db.auditEvent.findMany({where:{entityId:f.room.id}})).includes(key.token));
  }finally{await f.cleanup();}
});
