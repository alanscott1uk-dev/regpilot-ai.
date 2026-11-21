import test from "node:test";
import assert from "node:assert/strict";
import {collectGithub} from "../lib/connectors/github";
import {collectMicrosoftPolicy} from "../lib/connectors/microsoft-policy";
const target={repository:"example/repository",branch:"main"};
function github(pages:any[],workflowStatus=200){const calls:string[]=[];return {calls,fetch:(async(url:any)=>{const u=String(url);calls.push(u);if(u.endsWith("/repository"))return Response.json({full_name:target.repository});if(u.endsWith("/branches/main"))return Response.json({name:"main"});if(u.endsWith("/protection"))return Response.json({},{status:404});if(u.includes("/rules/")){const p=Number(new URL(u).searchParams.get("page"));return Response.json(pages[p-1]??[],{headers:p<pages.length?{link:'<https://evil.invalid/never-follow>; rel="next"'}:{}});}return Response.json({default_workflow_permissions:"write",can_approve_pull_request_reviews:true},{status:workflowStatus});}) as typeof fetch};}
test("GitHub reads active rules across fixed-origin pages, keeps classic unknown, flags workflow defaults",async()=>{
 const f=github([[{type:"deletion"}],[{type:"pull_request",parameters:{required_approving_review_count:2}}]]),r=await collectGithub(target,"fixture",f.fetch);
 assert.equal(r.checks.find(c=>c.id==="peer-review")?.status,"UNKNOWN");
 assert.equal(r.checks.find(c=>c.id==="ruleset-peer-review")?.status,"PASS");
 assert.equal(r.checks.find(c=>c.id==="ruleset-coverage")?.status,"PASS");
 assert.equal(r.checks.find(c=>c.id==="workflow-token-permissions")?.status,"FAIL");
 assert.ok(f.calls.every(x=>new URL(x).origin==="https://api.github.com"));
});
test("GitHub caps rule pages and never invents missing requirements or permissions",async()=>{
 const f=github(Array.from({length:4},()=>[{type:"deletion"}]),403),r=await collectGithub(target,"fixture",f.fetch);
 assert.equal(f.calls.filter(x=>x.includes("/rules/")).length,3);
 for(const id of ["ruleset-peer-review","ruleset-coverage","workflow-token-permissions"])assert.equal(r.checks.find(c=>c.id===id)?.status,"UNKNOWN");
});
test("GitHub refuses missing branch, malformed rule collection and authentication failures",async()=>{
 for(const bad of ["branch","rules","auth"]){const f=github([[]]);await assert.rejects(()=>collectGithub(target,"fixture",(async(url:any,init:any)=>bad==="branch"&&String(url).endsWith("/branches/main")?Response.json({name:"other"}):bad==="rules"&&String(url).includes("/rules/")?Response.json({not:"list"}):bad==="auth"&&String(url).endsWith("/protection")?Response.json({},{status:401}):f.fetch(url,init)) as typeof fetch));}
});
const policy=(state:string,controls:string[],operator="OR")=>({id:"never-store-policy",displayName:"NEVER STORE THIS",state,grantControls:{operator,builtInControls:controls}});
const read=async(r:Response)=>r.json();
test("Microsoft policy count excludes report-only, disabled and optional MFA",async()=>{
 for(const row of [policy("enabledForReportingButNotEnforced",["mfa"]),policy("disabled",["mfa"]),policy("enabled",["mfa","compliantDevice"])]){
  const r=await collectMicrosoftPolicy(async()=>Response.json({value:[row]}),read);
  assert.equal(r.coverage.explicitMfa,0);assert.equal(r.checks[1].status,"FAIL");assert.doesNotMatch(JSON.stringify(r),/never-store|NEVER STORE/);
 }
 for(const row of [policy("enabled",["mfa"]),policy("enabled",["mfa","compliantDevice"],"AND")])assert.equal((await collectMicrosoftPolicy(async()=>Response.json({value:[row]}),read)).checks[1].status,"PASS");
});
test("Microsoft policy API permission failure is unknown and pagination cannot exfiltrate credentials",async()=>{
 assert.ok((await collectMicrosoftPolicy(async()=>new Response(null,{status:403}),read)).checks.every(c=>c.status==="UNKNOWN"));
 let calls=0;await assert.rejects(()=>collectMicrosoftPolicy(async()=>{calls++;return Response.json({value:[],"@odata.nextLink":"https://evil.invalid/"});},read));assert.equal(calls,1);
});
test("Microsoft policy report is bounded and incomplete at the page cap",async()=>{
 let page=0;const r=await collectMicrosoftPolicy(async()=>Response.json({value:[{...policy("disabled",[]),id:String(++page)}],"@odata.nextLink":"https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies?$skiptoken="+page}),read);
 assert.equal(page,3);assert.equal(r.coverage.complete,false);assert.equal(r.checks[1].status,"UNKNOWN");
});
