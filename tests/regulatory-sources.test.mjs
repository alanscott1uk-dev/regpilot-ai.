import test from "node:test";
import assert from "node:assert/strict";
import { REGULATORY_SOURCES, normaliseContent } from "../lib/regulatory-sources.mjs";
test("only approved GOV.UK source paths",()=>{
 for(const s of REGULATORY_SOURCES){assert.match(s.path,/^\/(guidance|government)\/[a-z0-9/-]+$/);assert.ok(s.agency==="MHRA"||s.agency==="Home Office");}
});
test("normalises public source metadata without interpreting compliance",()=>{
 const result=normaliseContent(REGULATORY_SOURCES[0],{title:"Example",public_updated_at:"2026-10-20T12:00:00Z",description:"Test"});
 assert.equal(result.status,"available");assert.equal(result.updatedAt,"2026-10-20T12:00:00Z");assert.match(result.url,/^https:\/\/www.gov.uk\//);
});
test("rejects malformed API data",()=>assert.throws(()=>normaliseContent(REGULATORY_SOURCES[0],null)));
