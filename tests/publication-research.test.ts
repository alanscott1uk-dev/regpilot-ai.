import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {REGULATORY_SOURCES, officialSourceUrl, type RegulatorySource} from "../lib/regulatory-sources.mjs";
import {researchCandidates, researchPublications, type ResearchReader} from "../lib/regulatory/research";
import {createResearchReader} from "../lib/server/publication-research";
import {resolveResearchQuote} from "../lib/ai/research-grounding";
import {annotateDraft} from "../lib/server/ai-model";
import {reviewOutputForStorage} from "../lib/ai/review-policy.mjs";
import {POST} from "../app/api/ai/research/route";

const cases: [string,string][] = [
  ["Which guidance covers good manufacturing practice for medicines?","mhra-gmp-gdp"],
  ["Where can a pharmaceutical distributor apply for a WDA(H)?","mhra-manufacturer-wholesale"],
  ["Where can I check pharmaceutical GDP standards?","mhra-gmp-gdp"],
  ["What does a Scottish food business need to do before opening?","fss-starting-business"],
  ["Which body covers waste duty of care in Wales?","nrw-waste-duty"],
  ["Which body covers waste duty of care in Scotland?","sepa-waste-duty"],
  ["Where are the rules on risk assessments in Northern Ireland?","hseni-risk-assessment"],
  ["Which guidance addresses the Northern Ireland medical device market?","mhra-device-ni"],
  ["Which guidance covers post-market surveillance for medical devices in England?","mhra-device-surveillance"],
  ["Which rules govern checking a job applicant’s right to work?","employer-right-work"],
  ["Are there standards on handling flexible working requests?","acas-flexible-working"],
  ["Where are the rules on AML registration?","hmrc-aml-registration"],
  ["How do I reclaim VAT and keep records?","vat-records"],
  ["Where do I look for EPR obligations for packaging?","packaging-epr-scope"],
  ["How should I seek approval for a UK clinical trial?","mhra-clinical-approval"],
  ["Which regulator oversees the Consumer Duty for financial services?","fca-consumer-duty"],
  ["Where can directors verify their identity for Companies House?","companies-house-identity"],
  ["Which records should a sponsor keep for sponsored workers?","employer-sponsor-records"],
  ["standard operating procedures","home-office-controlled-drug-sops"],
  ["S.O.P.s","home-office-controlled-drug-sops"],
  ["temperature mappping","mhra-temperature-mapping"],
  ["temperature mapping","sps-medicines-temperature-mapping"],
];
test("reference catalogue benchmark across pharma and UK nations",t=>{
  let first=0,reciprocalRank=0;
  for(const [question,expected] of cases) {
    const rank=researchCandidates({question}).sources.findIndex(s=>s.id===expected)+1;
    assert.ok(rank>0 && rank<=3,question);
    if(rank===1) first++;
    reciprocalRank+=1/rank;
  }
  t.diagnostic(`Expected source in first three: ${cases.length}/${cases.length}. First choice: ${first}/${cases.length}. Mean reciprocal rank: ${(reciprocalRank/cases.length).toFixed(3)}.`);
});
test("unsupported questions make no publisher requests and geographic terms cannot cause false hits",async()=>{
  for (const question of ["What was UK GDP growth last quarter?","How far away is Mars?","Does Scotland have purple zebras?","What about quantum gravity?","How do I install a computer operating system?"]) {
    const result=await researchPublications({question},async()=>assert.fail("unexpected publisher read"));
    assert.equal(result.status,"no_match",question);assert.equal(result.checked.length,0);
  }
  const result=researchCandidates({question:"Which rules apply for post-market surveillance of medical devices?",nation:"Northern Ireland"});
  assert.ok(!result.sources.some(s=>s.id==="mhra-device-surveillance"));
  const regional=researchCandidates({question:"Where can we check market access rules for a medical device in Northern Ireland?"});
  assert.ok(regional.sources.some(s=>s.id==="mhra-device-ni"),"A cross-UK market access title must not displace the relevant NI publication");
  assert.deepEqual(researchCandidates({question:"What records must we keep when we charge or reclaim VAT?"}).sources.map(s=>s.id),["vat-records"]);
});

const query={question:"Which publications cover GMP and wholesale dealer licensing for medicines?"};
const sources=REGULATORY_SOURCES.filter(s=>["mhra-gmp-gdp","mhra-manufacturer-wholesale"].includes(s.id));
const bodies:Record<string,string>={
  "mhra-gmp-gdp":"Introductory material for this fictional publication. 📦 Good manufacturing practice for medicines includes detailed controlled instructions in this test document.",
  "mhra-manufacturer-wholesale":"A fictional publication used for reproducible checks. The wholesale medicine licence entry describes the fictional distributor and its documented scope.",
};
const read:ResearchReader=async s=>({id:s.id,title:s.title,url:officialSourceUrl(s),text:bodies[s.id],revisionAt:null,updatedAt:null,checkedAt:"2026-11-20T10:00:00.000Z"});
test("citations are stable and round-trip to the exact UTF-16 source range and full text hash",async()=>{
  const result=await researchPublications(query,read,sources);
  assert.equal(result.status,"matched");
  assert.equal(new Set(result.citations.map(c=>c.sourceId)).size,2);
  for (const c of result.citations) {
    assert.equal(bodies[c.sourceId].slice(c.start,c.end),c.quote);
    assert.equal(createHash("sha256").update(bodies[c.sourceId]).digest("hex"),c.documentHash);
    assert.ok(c.quote.length<=480);
  }
  const again=await researchPublications(query,read,[...sources].reverse());
  assert.deepEqual(result.citations,again.citations);
  const changed=await researchPublications(query,async s=>({...await read(s),text:bodies[s.id]+" The publication has changed."}),sources);
  assert.ok(changed.citations.every(c=>!result.citations.some(old=>old.id===c.id)));
});
test("failed reads, wrong identities and real pages with no matching text retain distinct coverage",async()=>{
  const partial=await researchPublications(query,async s=>{if(s===sources[0])throw Error("publisher unavailable");return read(s);},sources);
  assert.equal(partial.unavailable,1);assert.equal(partial.status,"matched");
  const wrong=await researchPublications(query,async s=>({...await read(s),url:"https://example.invalid/unverified"}),sources);
  assert.equal(wrong.status,"incomplete");assert.equal(wrong.citations.length,0);
  const unrelated=await researchPublications(query,async s=>({...await read(s),text:"Our internal fictional catalogue displays only a map of beaches and hills. A dog crossed the street on its way home."}),sources);
  assert.equal(unrelated.status,"no_match");assert.ok(unrelated.checked.every(s=>s.status==="no_passage"));
});
test("long text that crosses a word boundary retains exact offsets",async()=>{
  const text="📋 Wholesale medicine licence terms appear in this fictional reference ".repeat(50);
  const result=await researchPublications(query,async s=>({...await read(s),text}),sources);
  assert.ok(result.citations.length>0);
  for(const p of result.citations){assert.equal(p.quote,text.slice(p.start,p.end));assert.ok(p.quote.length<=480);}
});
test("unmatched, duplicated and cross-publication model quotations are omitted even from the summary",async()=>{
  const research=await researchPublications(query,read,sources);
  const p=research.citations.find(c=>c.sourceId==="mhra-gmp-gdp")!;
  const quote="Good manufacturing practice for medicines";
  assert.equal(resolveResearchQuote(quote,[p,p]),null);
  assert.equal(resolveResearchQuote(quote,[{...p,quote:quote+" "+quote}]),null);
  assert.equal(resolveResearchQuote(quote.toUpperCase(),[p]),null);
  const finding={type:"observation" as const,priority:"low" as const,title:"Consult the wording",rationale:"Review the cited source.",recommendation:"Compare the original with your procedure.",sourceQuote:quote,documentQuote:""};
  const output={summary:"UNSUPPORTED SUMMARY",confidence:"moderate" as const, findings:[finding,{...finding,sourceQuote:"A fabricated quotation."}],
    suggestedActions:[],suggestedAmendments:[],questions:["UNSUPPORTED QUESTION"],limitations:["UNSUPPORTED CONCLUSION"]};
  const ai=annotateDraft({mode:"assistant",documentText:"",question:query.question,businessContext:"",fileBytes:null},null,output,research);
  assert.equal(ai.findings.length,1);assert.equal(ai.research?.omitted,1);
  assert.equal(ai.findings[0].sourceCitation.sourceId,p.sourceId);
  assert.equal(bodies[p.sourceId].slice(ai.findings[0].sourceAnchor.start,ai.findings[0].sourceAnchor.end),quote);
  assert.ok(!JSON.stringify(ai).includes("UNSUPPORTED"));
  assert.deepEqual(reviewOutputForStorage(ai).research,ai.research);
});
test("only public register IDs are fetched and concurrent requests, expiry and outages are bounded",async()=>{
  let time=Date.parse("2026-11-20T10:00:00Z"),attempts=0,available=true;
  const cached=createResearchReader(async s=>{attempts++;if(!available)throw Error("Unavailable");return read(s);},()=>time);
  const source=sources[0];
  const [a,b]=await Promise.all([cached(source),cached({...source,url:"https://example.invalid"})]);
  assert.deepEqual(a,b);assert.equal(attempts,1);
  time+=9*60000;await cached(source);assert.equal(attempts,1);
  time+=60000;available=false;await assert.rejects(cached(source));await assert.rejects(cached(source));assert.equal(attempts,2);
  time+=60000;available=true;const fresh=await cached(source);assert.notEqual(fresh.checkedAt,a.checkedAt);assert.equal(attempts,3);
  await assert.rejects(cached({...source,id:"unregistered"} as RegulatorySource));assert.equal(attempts,3);
});
test("public research endpoint works without AI credentials and enforces its query contract",async()=>{
  const post=(body:unknown)=>POST(new Request("https://example.test/api/ai/research",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}));
  const unsupported=await post({question:"Are there zebras on Mars?"});
  assert.equal(unsupported.status,200);assert.equal((await unsupported.json()).status,"no_match");
  assert.equal((await post({question:"  hi  "})).status,400);
  assert.equal((await post({question:"xyz"})).status,200);
  assert.equal((await post({question:"Which UK guidance?",url:"https://example.invalid"})).status,400);
  assert.equal((await post({question:"x".repeat(9000)})).status,413);
  assert.equal((await POST(new Request("https://example.test",{method:"POST",body:"hello"}))).status,415);
});

test("the local model answers a paraphrase with an entire sentence inside its verified source passage",async()=>{
  const source=REGULATORY_SOURCES.find(s=>s.id==="home-office-controlled-drug-sops")!;
  const body="Fictional guidance for this test. Staff should be given clear written instructions for handling controlled drugs and should be able to locate them at work.";
  const reader:ResearchReader=async s=>({...await read(s),text:body});
  for(const question of ["How do I write instructions for staff handling controlled medicines?","How do I write instructions for staff handling controlled drugs?"]) {
    const result=await researchPublications({question},reader,[source]);
    assert.equal(result.answer.model,"potion-base-8M");
    const point=result.answer.points[0];assert.ok(point,question);
    assert.equal(point.text,body.slice(body.indexOf("Staff should")));
    const citation=result.citations.find(c=>c.id===point.citationId)!;
    assert.ok(citation.start<=point.start && point.end<=citation.end);
    assert.equal(body.slice(point.start,point.end),point.text);
  }
  const cost=await researchPublications({question:"How much do standard operating procedures cost?"},async s=>({...await read(s),text:"A standard operating procedure describes the agreed process. Staff should review standard operating procedures and follow them consistently."}),[source]);
  assert.equal(cost.answer.points.length,0,"related guidance must not answer an unsupported price question");
  const unrelated=await researchPublications({question:"geographic mapping"},reader);
  assert.equal(unrelated.answer.points.length,0);
});

test("reverification distinguishes edits, exact relocation, removal, ambiguity and damaged references",async()=>{
  const {validPassageReceipt,recheckPassage}=await import("../lib/regulatory/research");
  const original=await researchPublications(query,read,sources);
  const c=original.citations[0],doc=await read(sources.find(s=>s.id===c.sourceId)!);
  assert.ok(validPassageReceipt(c));assert.equal(recheckPassage(c,doc).status,"verified");
  assert.equal(recheckPassage(c,{...doc,text:doc.text+" Additional wording."}).status,"same_position");
  const prefix="New version. ";const moved=recheckPassage(c,{...doc,text:prefix+doc.text});
  assert.equal(moved.status,"relocated");assert.equal(moved.start,c.start+prefix.length);
  assert.equal(recheckPassage(c,{...doc,text:"A different publication body."}).status,"missing");
  assert.equal(recheckPassage(c,{...doc,text:doc.text+" "+c.quote}).status,"ambiguous");
  assert.ok(!validPassageReceipt({...c,id:"0".repeat(64)}));
  assert.ok(!validPassageReceipt({...c,quote:c.quote.replace(/./,"X")}));
  const {POST:verify}=await import("../app/api/ai/research/verify/route");
  const invalid=await verify(new Request("https://example.test/verify",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({id:c.id,documentHash:c.documentHash,sourceId:c.sourceId,start:c.start,end:c.end,quote:"unverified quotation"})}));
  assert.equal(invalid.status,400);
});
test("a GB-only passage in a UK-wide source cannot be returned as a Northern Ireland match",async()=>{
  const source=REGULATORY_SOURCES.find(s=>s.id==="mhra-device-markets")!;
  const gb="In Great Britain medical devices follow this fictional market registration procedure.";
  const ni="In Northern Ireland medical devices and their registration are discussed in this separate fictional text.";
  const text=gb+" "+"Other fictional background material. ".repeat(20)+ni;
  const result=await researchPublications({question:"Which guidance covers medical device registration in Northern Ireland?"},async s=>({...await read(s),text}),[source]);
  assert.ok(result.citations.some(c=>c.quote.includes(ni)));
  assert.ok(!result.citations.some(c=>c.quote.includes(gb)));
});
