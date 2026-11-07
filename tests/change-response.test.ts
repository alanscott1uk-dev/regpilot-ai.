import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {groupChangeWork,changeActionSchema,closeChangeSchema,createChangeSchema} from "../lib/change-response";
import {GET as LIST,POST as CREATE} from "../app/api/workspace/changes/route";
import {GET as PREVIEW} from "../app/api/workspace/changes/preview/route";
import {GET as DETAIL,PATCH as CLOSE} from "../app/api/workspace/changes/[id]/route";
import {PATCH as ACTION} from "../app/api/workspace/changes/actions/[id]/route";
import {GET as EXPORT} from "../app/api/workspace/changes/[id]/export/route";
test("shared-control benchmark: 100 requirements across four collections produce five owned actions without dropping scope",()=>{
 const controls=Array.from({length:5},()=>randomUUID()),ownerId=randomUUID();
 const rows=Array.from({length:100},(_,i)=>({requirementId:randomUUID(),revisionId:randomUUID(),decisionId:randomUUID(),reference:"R"+i,collection:"Collection "+i%4,controlId:controls[i%5],controlTitle:"Shared control "+i%5,controlVersion:1,ownerId,ownerName:"fictional@example.invalid"}));
 const result=groupChangeWork(rows);assert.equal(result.length,5);assert.equal(result.reduce((n,g)=>n+g.requirements.length,0),100);assert.equal(new Set(result.flatMap(g=>g.requirements.map(r=>r.requirementId))).size,100);assert.deepEqual(groupChangeWork([...rows].reverse()),result);assert.deepEqual(groupChangeWork([...rows,...rows]),result);
});
test("response decisions require explicit acknowledgement, bounded rationale, dates and unique evidence",()=>{
 const id=randomUUID(),base={action:"SUBMIT",version:1,notes:"A fictional resolution with sufficient detail to explain the changed control, its evidence and limits.",evidenceIds:[id],confirm:true};assert.ok(changeActionSchema.safeParse(base).success);
 for(const invalid of [{...base,confirm:false},{...base,evidenceIds:[id,id]},{...base,evidenceIds:[]},{...base,notes:"Done"},{...base,version:0}])assert.equal(changeActionSchema.safeParse(invalid).success,false);
 assert.equal(closeChangeSchema.safeParse({version:1,contextHash:"a".repeat(64),notes:base.notes,dependenciesReviewed:false,confirm:true}).success,false);
 assert.equal(createChangeSchema.safeParse({snapshotId:id,previewHash:"a".repeat(64),dueDate:"2026-02-30",confirm:true}).success,false);
});
test("all change-response APIs fail closed and authenticate before forged or oversized input",async()=>{
 const id=randomUUID(),params={params:Promise.resolve({id})},request=()=>new Request("https://example.invalid?organizationId="+id+"&snapshotId="+id,{method:"POST",body:JSON.stringify({role:"OWNER",padding:"x".repeat(50000)})});
 const calls=[()=>LIST(request()),()=>CREATE(request()),()=>PREVIEW(request()),()=>DETAIL(request(),params),()=>CLOSE(request(),params),()=>ACTION(request(),params),()=>EXPORT(request(),params)];
 process.env.REGPILOT_WORKSPACE_ENABLED="false";for(const call of calls){const r=await call();assert.equal(r.status,503);assert.equal(r.headers.get("cache-control"),"no-store");}
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:"true",DATABASE_URL:"postgresql://unused@127.0.0.1/unused",SUPABASE_URL:"https://example.invalid",SUPABASE_PUBLISHABLE_KEY:"fixture",REGPILOT_AI_ALLOWED_EMAILS:"fixture@example.invalid"});for(const call of calls)assert.equal((await call()).status,401);
});
