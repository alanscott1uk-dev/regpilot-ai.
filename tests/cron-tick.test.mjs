import test from "node:test";
import assert from "node:assert/strict";
import {executeScheduledTick,validCronSecret} from "../lib/cron-tick.mjs";
test("cron is fail-closed without a sufficiently strong exact secret",()=>{
 const secret="a".repeat(48);
 assert.equal(validCronSecret("Bearer "+secret,secret),true);
 for(const h of ["",secret,"bearer "+secret,"Bearer "+secret+" ","Bearer "+"x".repeat(48)])assert.equal(validCronSecret(h,secret),false);
 assert.equal(validCronSecret("Bearer short","short"),false);
});
test("an isolated failing provider cannot suppress other bounded workflows",async()=>{
 const called=[];
 const result=await executeScheduledTick({
  sources:async()=>{called.push("sources");return {processed:2,outcomes:["UNCHANGED","CONTENT_CHANGED"]};},
  connectors:async()=>{called.push("connectors");throw Error("private credential must not escape");},
  controlReviews:async()=>{called.push("reviews");return {processed:3};}
 });
 assert.deepEqual(called.sort(),["connectors","reviews","sources"]);
 assert.equal(result.ok,false);assert.equal(result.modules.connectors.state,"failed");
 assert.equal(result.modules.sources.processed,2);assert.equal(result.modules.controlReviews.processed,3);
 assert.doesNotMatch(JSON.stringify(result),/credential/);
});
test("disabled work is explicit rather than reported as successful live monitoring",async()=>{
 const result=await executeScheduledTick({});
 assert.equal(result.ok,true);assert.equal(result.modules.sources.state,"disabled");
 assert.equal(result.modules.connectors.state,"disabled");
 assert.equal(result.modules.controlReviews.state,"disabled");
});

test("partial connector failures trigger a non-green worker result with actionable attention",async()=>{
 const result=await executeScheduledTick({sources:async()=>({processed:2,outcomes:["UNCHANGED","CONTENT_CHANGED"]}),
 connectors:async()=>({processed:3,outcomes:["OBSERVED","RETRY_SCHEDULED","ATTENTION"]}),
 controlReviews:async()=>({processed:2,attention:1})});
 assert.equal(result.ok,false);
 assert.equal(result.modules.sources.state,"completed");
 assert.equal(result.modules.connectors.state,"attention");
 assert.equal(result.modules.connectors.attention,2);
 assert.equal(result.modules.controlReviews.state,"attention");
});
test("fully processed but bounded backlog remains visible and never silently claims full coverage",async()=>{
 const result=await executeScheduledTick({sources:async()=>({processed:12,limitReached:true,outcomes:["UNCHANGED"]})});
 assert.equal(result.modules.sources.state,"backlog");
 assert.equal(result.modules.sources.processed,12);
});
