import test from "node:test";
import assert from "node:assert/strict";
import { REGULATORY_SOURCES, normaliseContent } from "../lib/regulatory-sources.mjs";
test("only approved GOV.UK source paths",()=>{
 for(const s of REGULATORY_SOURCES.filter(s=>s.provider!=="OFFICIAL_WEB")){assert.match(s.path,/^\/[a-z0-9]+(?:[/-][a-z0-9]+)*$/);assert.ok(["MHRA","Home Office","GOV.UK","HMRC","Food Standards Agency","Companies House","Department of Health and Social Care","GOV.UK","Home Office"].includes(s.agency));}
 assert.equal(new Set(REGULATORY_SOURCES.map(s=>s.id)).size,REGULATORY_SOURCES.length);
});
test("catalogue includes meaningful cross-sector coverage without treating tags as legal applicability",()=>{
 const ids=REGULATORY_SOURCES.map(s=>s.id);
 assert.ok(ids.length>=38);
 for(const id of ["companies-house-identity","employer-right-work-guide","modern-slavery-supply","food-labelling","mhra-gmp-gdp","mhra-manufacturer-wholesale"]){
   const source=REGULATORY_SOURCES.find(s=>s.id===id);
   assert.ok(source && source.activities?.length && source.jurisdictions?.length && source.scopeNote);
   assert.match(source.path,/^\\/[a-z0-9/-]+$/);
 }
});
test("normalises public source metadata without interpreting compliance",()=>{
 const result=normaliseContent(REGULATORY_SOURCES.find(s=>s.id==="uk-data-protection"),{title:"Example",public_updated_at:"2026-10-20T12:00:00Z",description:"Test"});
 assert.equal(result.status,"available");assert.equal(result.updatedAt,"2026-10-20T12:00:00Z");assert.match(result.url,/^https:\/\/www.gov.uk\//);
});
test("rejects malformed API data",()=>assert.throws(()=>normaliseContent(REGULATORY_SOURCES.find(s=>s.id==="uk-data-protection"),null)));
