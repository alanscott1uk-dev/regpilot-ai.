import test from "node:test";
import assert from "node:assert/strict";
import {analysePublication,evidenceReadiness,hashValue,matchControls,parseProfile} from "../lib/regulatory/intelligence";
const profile={activities:["controlled-drugs"],jurisdictions:["Scotland"]};
const text="Businesses must retain supplier assessment records. Staff should receive documented training before handling controlled drugs. You must not allow unauthorised access to secure areas.";

test("obligation candidates retain exact source offsets and separate advice from mandatory language",()=>{
  const result=analysePublication({sourceId:"home-office-domestic",text,profile});
  assert.equal(result.candidates.length,3);
  assert.deepEqual(result.candidates.map(c=>c.language),["mandatory-language","recommendation","prohibition"]);
  for(const c of result.candidates){assert.equal(text.slice(c.start,c.end),c.quote);assert.equal(c.change,"baseline");assert.equal(c.applicability,"potential-match");}
  assert.ok(result.candidates[0].questions.some(q=>q.includes("territorial")));
});
test("changed language is prioritised but unchanged passages remain visible",()=>{
  const changed=text.replace("supplier assessment records","quarterly supplier assessment records");
  const result=analysePublication({sourceId:"home-office-domestic",text:changed,previousText:text,profile});
  assert.equal(result.candidates[0].change,"added-or-reworded");assert.equal(result.candidates[0].priority,"review-first");
  assert.equal(result.candidates.filter(c=>c.change==="existing").length,2);
});
test("topic mismatch is uncertainty, never a legal exemption",()=>{
  const result=analysePublication({sourceId:"home-office-domestic",text,profile:{activities:["personal-data"],jurisdictions:[]}});
  assert.ok(result.candidates.every(c=>c.applicability==="needs-context"));
  assert.ok(result.candidates[0].reasons[0].includes("does not establish an exemption"));
});
test("conditional and negative passages retain mandatory human questions",()=>{
  const result=analysePublication({sourceId:"home-office-domestic",text:"If you hold an exemption you are not required to apply for a licence. Otherwise you must maintain records for the activity.",profile});
  assert.ok(result.candidates[0].questions.some(q=>q.includes("exception")));
  assert.ok(result.candidates[0].questions.some(q=>q.includes("removal")));
});
test("dates are quoted mentions; the engine never generates legal or task deadlines",()=>{
  const result=analysePublication({sourceId:"home-office-domestic",text:"From 1 January 2027 businesses must keep accurate supplier records and review the arrangements regularly.",profile});
  assert.deepEqual(result.candidates[0].dateMentions,["1 January 2027"]);
  assert.equal("dueDate" in result.candidates[0],false);
});
test("control matches explain token matches and do not perform substring false positives",()=>{
  assert.equal(matchControls("A personalisation preference").length,0);
  const matched=matchControls("Maintain documented staff training records");
  assert.ok(matched.some(m=>m.id==="training"&&m.matchedTerms.includes("training")));
  assert.ok(matched.every(m=>m.evidenceNeeded.length&&m.domains.length));
});
test("empty and bounded extraction disclose coverage limits",()=>{
  const result=analysePublication({sourceId:"home-office-domestic",text:"This is an introductory publication explaining the general background of the topic and related information.",profile});
  assert.equal(result.candidates.length,0);assert.ok(result.warnings.some(w=>w.includes("no obligations")));
  const many=analysePublication({sourceId:"home-office-domestic",text:Array.from({length:40},(_,i)=>`Business ${i} must retain its supplier assessment records.`).join(" "),profile});
  assert.equal(many.candidates.length,30);assert.equal(many.candidateLimitReached,true);
  assert.throws(()=>analysePublication({sourceId:"home-office-domestic",text:"a".repeat(20001),profile}));
});
test("profiles validate values and canonical hashes survive JSONB ordering",()=>{
  assert.throws(()=>parseProfile({activities:["all-businesses"],jurisdictions:[]}));
  assert.deepEqual(parseProfile({activities:["medicines","medicines"],jurisdictions:["Wales"]}).activities,["medicines"]);
  assert.equal(hashValue({b:1,a:{d:2,c:3}}),hashValue({a:{c:3,d:2},b:1}));
});
test("evidence assessment refuses self-approved or unscanned files and never claims sufficiency",()=>{
  assert.equal(evidenceReadiness([]).state,"missing-evidence");
  const row={scanStatus:"CLEAN",reviewStatus:"APPROVED",uploadedById:"one",reviewerId:"one",reviewedAt:new Date()};
  assert.equal(evidenceReadiness([row]).independentlyReviewed,0);
  assert.equal(evidenceReadiness([{...row,reviewerId:"two",scanStatus:"QUARANTINED"}]).independentlyReviewed,0);
  const result=evidenceReadiness([{...row,reviewerId:"two"}]);
  assert.equal(result.independentlyReviewed,1);assert.match(result.nextStep,/cannot establish adequacy/);
});

test("new UK source catalogue provides activity-aware intelligence suggestions without invented legal applicability",()=>{
 const quote="Manufacturers must retain documented staff training and pharmaceutical manufacturing records for independent review.";
 const medicine=analysePublication({sourceId:"mhra-gmp-gdp",text:quote,profile:{activities:["medicines"],jurisdictions:["Scotland"]}});
 assert.equal(medicine.candidates[0].applicability,"potential-match");
 assert.ok(medicine.candidates[0].reasons.some(s=>s.includes("discovery tags")));
 const supply=analysePublication({sourceId:"modern-slavery-supply",text:quote,profile:{activities:["supply-chain"],jurisdictions:["Wales"]}});
 assert.equal(supply.candidates[0].applicability,"potential-match");
});
test("devolved nation tags cannot silently create irrelevant matched obligations",()=>{
 const quote="Employers must retain documented records of workforce policies and related training.";
 const ni=analysePublication({sourceId:"acas-disciplinary",text:quote,profile:{activities:["employing-staff"],jurisdictions:["Northern Ireland"]}});
 assert.equal(ni.candidates[0].applicability,"needs-context");
 assert.ok(ni.candidates[0].reasons.some(x=>x.includes("territory tags do not overlap")));
 const gb=analysePublication({sourceId:"acas-disciplinary",text:quote,profile:{activities:["employing-staff"],jurisdictions:["Scotland"]}});
 assert.equal(gb.candidates[0].applicability,"potential-match");
 const england=analysePublication({sourceId:"fss-starting-business",text:quote,profile:{activities:["food-business"],jurisdictions:["England"]}});
 assert.equal(england.candidates[0].applicability,"needs-context");
});
