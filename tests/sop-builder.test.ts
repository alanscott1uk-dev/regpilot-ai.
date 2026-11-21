import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {createHash} from "node:crypto";
import {parseDocx} from "../lib/server/docx-parser.mjs";
import {buildSopDocument} from "../lib/server/sop-document";
import {newSopDraft,sopDraftSchema,sopOpenItems,sopHref,sopIntent,type SopReceipt} from "../lib/sop-draft";
import {helpArticles,searchHelp} from "../lib/help-centre";
import {POST} from "../app/api/sop-builder/export/route";
const hash=(text:string)=>createHash("sha256").update(text).digest("hex");
const quote="This is a synthetic passage used to test document provenance.";
const sourceId="mhra-temperature-mapping";
const documentHash=hash(quote);
const receipt:SopReceipt={sourceId,documentHash,start:0,end:quote.length,quote,id:hash(JSON.stringify([sourceId,documentHash,0,quote.length,quote]))};
const verified={status:"verified" as const,documentHash,checkedAt:"2026-11-20T10:00:00.000Z",start:0,end:quote.length};
test("the user's SOP queries and multiple sectors have editable starting points",()=>{
  for(const q of ["standard operating procedures","S.O.P.","temperature mappping","staff offboarding","supplier qualification","allergen handover"])assert.equal(sopIntent(q),true,q);
  assert.equal(newSopDraft("temperature mappping").starter,"mapping");
  assert.equal(newSopDraft("offboarding").starter,"leaver");
  assert.equal(newSopDraft("CNC changeover").title,"CNC changeover");
  assert.equal(newSopDraft("standard operating procedures").title,"");
  assert.equal(sopHref("temperature mapping","Scotland"),"/sop-builder#q=temperature+mapping&nation=Scotland");
  const draft=newSopDraft("supplier qualification");draft.steps[0].role="Receiving lead";
  assert.deepEqual(sopDraftSchema.parse(JSON.parse(JSON.stringify(draft))),draft);
  assert.ok(!sopOpenItems(draft).includes("Step 1 responsible role"));
  assert.ok(sopOpenItems(draft).includes("Step 2 responsible role"));
  assert.equal(sopDraftSchema.safeParse({...draft,steps:[]}).success,false);
  assert.equal(sopDraftSchema.safeParse({...draft,sources:[receipt,receipt]}).success,false);
  assert.equal(sopDraftSchema.safeParse({...draft,steps:[{...draft.steps[0],citationId:receipt.id}]}).success,false);
});
test("the actual Word file round-trips through the vault parser with exact source identity and draft status",async()=>{
  const draft={...newSopDraft("Temperature mapping"),title:"West <Store> & QA",reference:"SOP-001",nation:"Scotland" as const,sources:[receipt]};
  draft.steps[0].citationId=receipt.id;
  const value=await buildSopDocument(draft,async()=>verified);
  assert.equal(value.filename,"SOP-001-draft.docx");
  const extracted=await parseDocx(value.bytes),text=extracted.pages.map((x:{text:string})=>x.text).join("\n");
  for(const phrase of ["DRAFT FOR REVIEW","West <Store> & QA","Site decisions to confirm","Incomplete draft fields","Supporting passage 1",quote,documentHash,"MHRA Inspectorate","https://"])assert.ok(text.includes(phrase),phrase);
  assert.deepEqual(extracted.blockingIssues,[]);
});
test("stale, fabricated, out-of-scope and unavailable source passages cannot acquire verified provenance",async()=>{
  const d={...newSopDraft("Mapping"),sources:[receipt]};
  await assert.rejects(buildSopDocument(d,async()=>({...verified,status:"relocated"})),/has changed/);
  await assert.rejects(buildSopDocument(d,async()=>{throw Error("offline");}),/could not be rechecked/);
  await assert.rejects(buildSopDocument({...d,sources:[{...receipt,quote:"edited quotation"}]},async()=>verified),/invalid/);
  await assert.rejects(buildSopDocument({...d,sources:[{...receipt,sourceId:"unknown"}]},async()=>verified),/invalid/);
  const scoped="sps-aseptic-sops",ref={...receipt,sourceId:scoped,id:hash(JSON.stringify([scoped,documentHash,0,quote.length,quote]))};
  await assert.rejects(buildSopDocument({...d,nation:"Scotland",sources:[ref]},async()=>verified),/outside/);
});
test("export endpoint enforces request boundaries and can export a draft with no available sources",async()=>{
  const put=(data:unknown,type="application/json")=>POST(new Request("http://localhost/api/sop-builder/export",{method:"POST",headers:{"content-type":type},body:JSON.stringify(data)}));
  const good=await put(newSopDraft("Staff offboarding"));assert.equal(good.status,200);
  assert.equal(good.headers.get("cache-control"),"no-store");
  assert.match(good.headers.get("content-type")||"",/wordprocessingml/);
  const t=await parseDocx(Buffer.from(await good.arrayBuffer()));
  assert.ok(t.pages.some((v:{text:string})=>v.text.includes("No official publication passages")));
  assert.equal((await put(newSopDraft(""))).status,400);
  assert.equal((await put({title:"X".repeat(200*1024)})).status,413);
  assert.equal((await put({},"text/plain")).status,415);
});
test("help resolves actual tasks, spelling variants and valid product links",()=>{
  for(const [q,id] of [["temperature mappping","temperature-mapping"],["standard operating procedures","sop-builder"],["stale connection","connections"],["corrective action","corrective-actions"],["Home Office account","regulator-accounts"]]){
    assert.equal(searchHelp(q)[0]?.id,id,q);
  }
  assert.equal(searchHelp("gibberishword").length,0);
  assert.equal(searchHelp("add QuickBooks accounting software")[0]?.id,"accounting-software");
  assert.ok(searchHelp("supplier","Integrations").every(a=>a.category==="Integrations"));
  assert.equal(new Set(helpArticles.map(a=>a.id)).size,helpArticles.length);
  for(const a of helpArticles)for(const [,href] of a.links){
    const loc=new URL(href,"http://localhost");assert.ok(existsSync("app"+loc.pathname+"/page.tsx"),href);
  }
  assert.ok(readFileSync("app/components/workspace-nav.tsx","utf8").includes('href:"/help"'));
});
