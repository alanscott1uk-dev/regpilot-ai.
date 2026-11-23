import test from "node:test";
import assert from "node:assert/strict";
import {AUTHORITIES,findRelevantAuthorities} from "../lib/authority-registry.mjs";
test("registry has unique authority identifiers and official HTTPS sources",()=>{
 assert.equal(new Set(AUTHORITIES.map(x=>x.id)).size,AUTHORITIES.length);
 assert.ok(AUTHORITIES.every(x=>x.url.startsWith("https://")&&x.kind&&x.jurisdictions.length));
});
test("Scottish food businesses see Food Standards Scotland rather than FSA",()=>{
 const ids=findRelevantAuthorities({jurisdiction:"Scotland",sectors:["food"]}).map(x=>x.id);
 assert.ok(ids.includes("fss"));assert.ok(!ids.includes("fsa"));
});
test("England healthcare gets CQC rather than Scottish healthcare body",()=>{
 const ids=findRelevantAuthorities({jurisdiction:"England",sectors:["healthcare"]}).map(x=>x.id);
 assert.ok(ids.includes("cqc"));assert.ok(!ids.includes("his"));
});
test("UK authorities are only candidates and not compliance verdicts",()=>{
 assert.ok(findRelevantAuthorities({jurisdiction:"Scotland",sectors:["pharmaceuticals"]}).every(x=>x.applicability==="CANDIDATE_REVIEW_ONLY"));
});
