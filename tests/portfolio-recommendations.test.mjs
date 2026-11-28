import test from "node:test";
import assert from "node:assert/strict";
import {recommendSourcePortfolio} from "../lib/regulatory/portfolio-recommendations.mjs";
import {REGULATORY_SOURCES} from "../lib/regulatory-sources.mjs";
test("SME medicines business sees GMP/GDP and associated UK sources as starting points",()=>{
 const r=recommendSourcePortfolio(REGULATORY_SOURCES,{activities:["medicines"],jurisdictions:["Scotland"]});
 assert.ok(r.suggested.some(x=>x.id==="mhra-gmp-gdp"));
 assert.ok(r.suggested.some(x=>x.id==="mhra-safety"));
 assert.match(r.caveat,/not a legally validated/);
 assert.ok(r.suggested.every(x=>x.reason.includes("Confirm duties")));
});
test("Scottish staff rules suggest GB employment codes, Northern Ireland excludes those without treating it as an exemption",()=>{
 const scot=recommendSourcePortfolio(REGULATORY_SOURCES,{activities:["employing-staff"],jurisdictions:["Scotland"]});
 const ni=recommendSourcePortfolio(REGULATORY_SOURCES,{activities:["employing-staff"],jurisdictions:["Northern Ireland"]});
 assert.ok(scot.suggested.some(x=>x.id==="acas-disciplinary"));
 assert.ok(!ni.suggested.some(x=>x.id==="acas-disciplinary"));
 assert.ok(ni.differentTerritory.includes("acas-disciplinary"));
 assert.ok(ni.suggested.some(x=>x.id==="hseni-risk-assessment"));
});
test("unclassified sources remain identifiable, never silently cleared or declared nonapplicable",()=>{
 const result=recommendSourcePortfolio(REGULATORY_SOURCES,{activities:[],jurisdictions:[]});
 assert.equal(result.suggested.length,0);
 assert.ok(result.uncategorised.length>0);
 assert.ok(!result.differentTerritory.length);
});
test("industry recommendations are deterministic and de-duplicate incoming references",()=>{
 const duplicated=[...REGULATORY_SOURCES,...REGULATORY_SOURCES];
 const profile={activities:["food-business"],jurisdictions:["Scotland"]};
 const first=recommendSourcePortfolio(duplicated,profile),single=recommendSourcePortfolio(REGULATORY_SOURCES,profile);
 assert.deepEqual(first,single);
 assert.ok(single.suggested.some(x=>x.id==="fss-starting-business"));
});
