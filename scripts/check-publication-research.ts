import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdir,writeFile} from "node:fs/promises";
import {researchPublications, type ResearchDocument} from "../lib/regulatory/research";
import {createResearchReader} from "../lib/server/publication-research";

const cases = [
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
];

async function main() {
  const read = createResearchReader();
  const rows = [];
  for (const {question,expected} of cases) {
    const documents = new Map<string,ResearchDocument>();
    const result = await researchPublications({question},async source=>{
      const doc=await read(source); documents.set(doc.id,doc); return doc;
    });
    const returned=[...new Set(result.citations.map(c=>c.sourceId))];
    const exact=result.citations.every(c=>{
      const doc=documents.get(c.sourceId)!;
      return doc.text.slice(c.start,c.end)===c.quote && createHash("sha256").update(doc.text).digest("hex")===c.documentHash;
    });
    const passed=expected.every(id=>returned.includes(id)) && exact && (expected.length>0 || result.status==="no_match"&&result.checked.length===0);
    rows.push({question,expected,returned,exact,passages:result.citations.length,unavailable:result.unavailable,passed});
  }
  await mkdir("artifacts",{recursive:true});
  await writeFile("artifacts/publication-research.json",JSON.stringify({checkedAt:new Date().toISOString(),cases:rows},null,2)+"\n");
  for(const row of rows) console.log(JSON.stringify(row));
  assert.ok(rows.every(row=>row.passed),"One or more live retrieval cases failed");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
