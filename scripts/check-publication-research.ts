import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdir,writeFile} from "node:fs/promises";
import {researchPublications, type ResearchDocument} from "../lib/regulatory/research";
import {createResearchReader} from "../lib/server/publication-research";

const cases: {question:string; expected:string[]; manual?:string; answer?:{source:string; wording:RegExp}; abstain?:boolean}[] = [
  {question:"Which publications cover GMP and wholesale dealer licensing for medicines?",expected:["mhra-gmp-gdp","mhra-manufacturer-wholesale"]},
  {question:"What records must we keep when we charge or reclaim VAT?",expected:["vat-records"]},
  {question:"Where is the guidance on regulating medical devices in Northern Ireland?",expected:["mhra-device-ni"]},
  {question:"What was UK GDP growth last quarter?",expected:[]},
  {question:"Which publication deals with checking the identity of company directors?",expected:["companies-house-identity"]},
  {question:"Where can we check market access rules for a medical device in Northern Ireland?",expected:["mhra-device-ni"]},
  {question:"How does an employer prevent discrimination during right to work checks?",expected:["right-to-work-discrimination"]},
  {question:"Where can our compliance team check wholesale authorisation for medicinal products?",expected:["mhra-manufacturer-wholesale"]},
  {question:"Which sources discuss staff grievances and disciplinary procedures?",expected:["acas-disciplinary"]},
  {question:"Who regulates the duty of care for commercial refuse in Wales?",expected:["nrw-waste-duty"]},
  {question:"Where can we find standards for sponsoring a clinical trial?",expected:["mhra-clinical-approval"]},
  {question:"Does the catalogue cover astronomy or planetary orbits?",expected:[]},
  ...["standard operating procedures","SOP","SOPs"].map(question=>({question,
    expected:["home-office-controlled-drug-sops"],answer:{source:"home-office-controlled-drug-sops",wording:/SOP|standard operating procedure/i}})),
  ...["temperature mapping","temperature mappping"].map(question=>({question,
    expected:["mhra-temperature-mapping"],manual:"sps-medicines-temperature-mapping",answer:{source:"mhra-temperature-mapping",wording:/storage|warehouse|mapping|temperature/i}})),
  {question:"How do I find hot or cold spots in my medicines warehouse?",expected:["mhra-temperature-mapping"],
    answer:{source:"mhra-temperature-mapping",wording:/hot or cold spots|monitoring probes/i}},
  {question:"Where should I place thermometers in the stockroom?",expected:["mhra-temperature-mapping"],
    answer:{source:"mhra-temperature-mapping",wording:/thermometers|monitoring probes|monitoring devices/i}},
  {question:"How should I write instructions for staff handling controlled medicines?",expected:["home-office-controlled-drug-sops"],
    answer:{source:"home-office-controlled-drug-sops",wording:/staff|employees|instructions/i}},
  {question:"How do I install a computer operating system?",expected:[]},
  {question:"How much does temperature mapping cost?",expected:["mhra-temperature-mapping"],abstain:true},
];

async function main() {
  const read = createResearchReader();
  const rows = [];
  for (const {question,expected,answer,abstain,manual} of cases) {
    const documents = new Map<string,ResearchDocument>();
    const result = await researchPublications({question},async source=>{
      const doc=await read(source); documents.set(doc.id,doc); return doc;
    });
    const returned=[...new Set(result.citations.map(c=>c.sourceId))];
    const exact=result.citations.every(c=>{
      const doc=documents.get(c.sourceId)!;
      return doc.text.slice(c.start,c.end)===c.quote && createHash("sha256").update(doc.text).digest("hex")===c.documentHash;
    });
    const answerExact=result.answer.points.every(point=>{
      const doc=documents.get(point.sourceId),citation=result.citations.find(c=>c.id===point.citationId && c.sourceId===point.sourceId);
      return !!doc && !!citation && citation.start<=point.start && point.end<=citation.end && doc.text.slice(point.start,point.end)===point.text;
    });
    const answered=abstain?result.answer.points.length===0:!answer || result.answer.points.some(point=>point.sourceId===answer.source && answer.wording.test(point.text));
    const manualSignposted=!manual||result.checked.some(s=>s.id===manual&&s.status==="manual_refresh")&&!documents.has(manual)&&!returned.includes(manual);
    const passed=manualSignposted&&result.answer.model==="potion-base-8M" && expected.every(id=>returned.includes(id)) && exact && answerExact && answered &&
      (expected.length>0 || result.status==="no_match"&&result.checked.length===0&&result.answer.points.length===0);
    rows.push({question,expected,returned,manual,manualSignposted,exact,answerExact,answered,passages:result.citations.length,unavailable:result.unavailable,passed});
  }
  await mkdir("artifacts",{recursive:true});
  await writeFile("artifacts/publication-research.json",JSON.stringify({checkedAt:new Date().toISOString(),cases:rows},null,2)+"\n");
  for(const row of rows) console.log(JSON.stringify(row));
  assert.ok(rows.every(row=>row.passed),"One or more live retrieval cases failed");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
