import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {db} from "../lib/server/db";
import {createSemanticRun,semanticActivity} from "../lib/server/semantic-service";
import {saveBusinessProfile,getIntelligenceWorkspace,decideCandidate} from "../lib/server/intelligence-service";
import {sourceTextHash} from "../lib/regulatory/source-fingerprint.mjs";
import type {AuthorizedContext} from "../lib/server/authorization";
import type {Analysis} from "../lib/regulatory/intelligence";

test("semantic workflow: consent, single reservation, tenant isolation, independent review, changing context and failure recovery",async()=>{
  const suffix=randomUUID(),users=await Promise.all(["maker","reviewer"].map(n=>db.user.create({data:{externalId:n+suffix,email:n+suffix+"@example.invalid"}})));
  const orgs=await Promise.all(["A","B"].map(n=>db.organization.create({data:{name:"Fictional semantic "+n+suffix}}))),ids=orgs.map(o=>o.id);
  const ctx:AuthorizedContext={userId:users[0].id,organizationId:ids[0],role:"OWNER"},reviewer:AuthorizedContext={...ctx,userId:users[1].id,role:"ADMIN"};
  Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:"true",SUPABASE_URL:"https://example.invalid",SUPABASE_PUBLISHABLE_KEY:"fixture",REGPILOT_AI_ALLOWED_EMAILS:users.map(u=>u.email).join(","),REGPILOT_AI_ENABLED:"true",REGPILOT_AI_MODEL:"test/fictional",AI_GATEWAY_API_KEY:"fixture-never-used",REGPILOT_SEMANTIC_ENABLED:"true",REGPILOT_AI_SAFEGUARDS_VERIFIED:"true",REGPILOT_AI_DAILY_USER_LIMIT:"10",REGPILOT_AI_DAILY_ORG_LIMIT:"10"});
  const profile={activities:["personal-data"],jurisdictions:["Scotland"]};
  const passage="Fictional widget keepers retain records for five years unless an exemption applies.";
  const text=passage+" This wholly fictional publication is used to exercise independent review workflows.";
  const output={obligations:[{quote:passage,kind:"duty",subject:"Fictional widget keepers",action:"Check the fictional record retention process.",applicabilityReason:"The source relates to records but the business scope needs confirmation.",conditions:[],exceptions:["unless an exemption applies"],dateQuotes:[],controlIds:["records"],questions:["Does the exemption apply to this fictional business?"]}],limitations:["Fictional test only."]};
  let calls=0;const generate=async()=>{calls++;return output;};
  try{
    await db.membership.createMany({data:[{userId:ctx.userId,organizationId:ctx.organizationId,role:"OWNER"},{userId:reviewer.userId,organizationId:ctx.organizationId,role:"ADMIN"},{userId:ctx.userId,organizationId:ids[1],role:"OWNER"}]});
    await saveBusinessProfile(ctx,profile,0);
    const snapshot=await db.regulatorySnapshot.create({data:{organizationId:ctx.organizationId,sourceId:"uk-data-protection",title:"Fictional semantic source",url:"https://www.gov.uk/data-protection-your-business",bodyText:text,contentHash:sourceTextHash(text),capturedById:ctx.userId,reviewStatus:"REVIEWED",reviewerId:reviewer.userId,reviewedAt:new Date()}});
    await assert.rejects(()=>createSemanticRun(ctx,snapshot.id,false,generate),(e:any)=>e.status===400);
    await assert.rejects(()=>createSemanticRun({...ctx,organizationId:ids[1]},snapshot.id,true,generate),(e:any)=>e.status===404);
    await assert.rejects(()=>createSemanticRun({...ctx,role:"VIEWER"},snapshot.id,true,generate),(e:any)=>e.status===403);
    const results=await Promise.allSettled([createSemanticRun(ctx,snapshot.id,true,generate),createSemanticRun(ctx,snapshot.id,true,generate)]);
    assert.ok(results.some(r=>r.status==="fulfilled"));assert.equal(calls,1,"concurrent requests must never both call the provider");
    assert.equal(await db.semanticRequest.count({where:{organizationId:ids[0]}}),1);
    assert.equal((await db.aiDailyUsage.aggregate({where:{organizationId:ids[0]},_sum:{count:true}}))._sum.count,1);
    const reused=await createSemanticRun(ctx,snapshot.id,true,generate);assert.equal(reused.reused,true);assert.equal(calls,1);
    const run=(await getIntelligenceWorkspace(reviewer)).runs[0];assert.equal(run.integrityValid,true);
    const candidate=(run.result as unknown as Analysis).candidates[0];
    const decision={candidateKey:candidate.key,decision:"ACCEPTED",rationale:"Fictional scope and exemption reviewed by a second administrator.",title:"Review fictional retention",ownerName:"Test reviewer",dueDate:"2027-01-31"};
    await assert.rejects(()=>decideCandidate(ctx,run.id,decision),(e:any)=>e.status===403);
    const accepted=await decideCandidate(reviewer,run.id,decision);assert.ok(accepted.obligationId);
    await saveBusinessProfile(ctx,profile,1);
    await assert.rejects(()=>createSemanticRun(ctx,snapshot.id,true,async()=>{calls++;await saveBusinessProfile(reviewer,profile,2);return output;}),(e:any)=>e.status===409);
    assert.equal(await db.intelligenceRun.count({where:{organizationId:ids[0]}}),1,"stale AI output must be discarded");
    await assert.rejects(()=>createSemanticRun(ctx,snapshot.id,true,async()=>{calls++;throw new Error("raw provider credential must not leak");}),(e:any)=>e.status===503&&!e.message.includes("credential"));
    const before=calls;await assert.rejects(()=>createSemanticRun(ctx,snapshot.id,true,generate),(e:any)=>e.status===409);assert.equal(calls,before,"failed attempts are never silently replayed");
    const activity=await semanticActivity(ctx);assert.equal(activity.filter(r=>r.status==="FAILED").length,2);assert.doesNotMatch(JSON.stringify(activity),/credential/);
    assert.equal((await semanticActivity({...ctx,organizationId:ids[1]})).length,0);
    await saveBusinessProfile(ctx,profile,3);
    await assert.rejects(()=>createSemanticRun(ctx,snapshot.id,true,async()=>{await db.membership.delete({where:{organizationId_userId:{organizationId:ctx.organizationId,userId:ctx.userId}}});return output;}),(e:any)=>e.status===403);
    assert.equal(await db.intelligenceRun.count({where:{organizationId:ids[0]}}),1);
  }finally{
    await db.intelligenceDecision.deleteMany({where:{organizationId:{in:ids}}});await db.semanticRequest.deleteMany({where:{organizationId:{in:ids}}});await db.intelligenceRun.deleteMany({where:{organizationId:{in:ids}}});await db.businessProfile.deleteMany({where:{organizationId:{in:ids}}});
    await db.auditEvent.deleteMany({where:{organizationId:{in:ids}}});await db.aiDailyUsage.deleteMany({where:{organizationId:{in:ids}}});await db.obligation.deleteMany({where:{organizationId:{in:ids}}});await db.regulatorySnapshot.deleteMany({where:{organizationId:{in:ids}}});await db.membership.deleteMany({where:{organizationId:{in:ids}}});await db.organization.deleteMany({where:{id:{in:ids}}});await db.user.deleteMany({where:{id:{in:users.map(u=>u.id)}}});
  }
});
