import test from "node:test";
import assert from "node:assert/strict";
import {vendorAttention,compareVendorSignals} from "../lib/vendor-attention";
import type {Observation} from "../lib/connectors/observation";
test("supplier attention preserves conditional and rejected outcomes even with a current review",()=>{
 const v={active:true,reviewState:"CURRENT",recommendation:"APPROVE",nextReviewAt:"2099-01-01"};
 assert.equal(vendorAttention(v).needed,false);
 for(const recommendation of ["CONDITIONAL","REJECT"])assert.equal(vendorAttention({...v,recommendation}).needed,true);
 for(const reviewState of ["NOT_REVIEWED","STALE","EXPIRED"])assert.equal(vendorAttention({...v,reviewState}).needed,true);
 assert.equal(vendorAttention({...v,nextReviewAt:"2026-11-07"},"2026-11-07").needed,true);
 assert.equal(vendorAttention({...v,active:false,reviewState:"STALE"}).needed,false);
});
test("supplier comparison includes missing and new signals as well as changed values",()=>{
 const c=(id:string,observed:string)=>({id,label:id,status:"PASS" as const,observed,nextStep:"Inspect"});
 const before:Observation={engine:"fixture",sourceUrl:"https://example.invalid",capturedAt:"2026-11-07T00:00:00Z",checks:[c("same","a"),c("changed","a"),c("removed","a")],limitations:[]};
 const after={...before,checks:[c("same","a"),c("changed","b"),c("added","a")]};
 const delta=compareVendorSignals(after,before);assert.deepEqual(delta.map(c=>c.id),["changed","removed","added"]);assert.equal(delta[1].after,"No longer reported");assert.equal(delta[2].before,"Not previously reported");assert.deepEqual(compareVendorSignals(after,null),[]);
});
