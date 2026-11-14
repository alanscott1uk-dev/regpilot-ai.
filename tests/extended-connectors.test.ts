import test from "node:test";
import assert from "node:assert/strict";
import {collectGitlab} from "../lib/connectors/gitlab";
import {collectCloudflare} from "../lib/connectors/cloudflare";
import {collectCompaniesHouse} from "../lib/connectors/companies-house";
import {collectConfiguredConnector} from "../lib/server/connector-service";
import {CollectionError} from "../lib/connectors/github";
const token="fictional-read-only-credential",zoneId="a".repeat(32),accountId="b".repeat(32);
const json=(v:unknown,headers:Record<string,string>={})=>Response.json(v,{headers});
const code=(expected:string)=>(e:any)=>e instanceof CollectionError&&e.code===expected;
const project={id:123,path_with_namespace:"fictional/subgroup/project",only_allow_merge_if_pipeline_succeeds:true,only_allow_merge_if_all_discussions_are_resolved:true,owner:{email:"never-retain@example.invalid"}};
const rule=(name="main",allow_force_push=false)=>({name,allow_force_push,push_access_levels:[{access_level:0,user_id:null,group_id:null}]});
function gitlabFetch(rules:unknown[],headers:Record<string,string>={}):typeof fetch{return async(url,options)=>{assert.equal(options?.method,"GET");assert.equal(options?.redirect,"error");assert.equal(options?.cache,"no-store");assert.equal((options?.headers as any)["PRIVATE-TOKEN"],token);const u=String(url);assert.ok(u.startsWith("https://gitlab.com/api/v4/projects/"));return u.includes("/protected_branches?")?json(rules,headers):u.includes("/repository/branches/")?json({name:"main",protected:true}):json(project);};}
test("GitLab collection evaluates permissive overlapping wildcard rules and discards identity/contents",async()=>{
 const t={projectPath:project.path_with_namespace,branch:"main"};let r=await collectGitlab(t,token,gitlabFetch([rule(),rule("*")]));assert.ok(r.checks.every(c=>c.status==="PASS"));assert.doesNotMatch(JSON.stringify(r),/never-retain|owner|PRIVATE-TOKEN|fictional-read-only/);
 r=await collectGitlab(t,token,gitlabFetch([rule(),{...rule("*",true),push_access_levels:[{access_level:0,deploy_key_id:10}]}]));assert.equal(r.checks.find(c=>c.id==="force-push")!.status,"FAIL");assert.equal(r.checks.find(c=>c.id==="direct-push")!.status,"FAIL");
 r=await collectGitlab(t,token,gitlabFetch([rule(),rule("m.*",true),rule("*a".repeat(100)+"z",true)]));assert.ok(r.checks.every(c=>c.status==="PASS"),"regex punctuation stays literal and hostile wildcard patterns cannot alter unrelated rules");
 const hostile=gitlabFetch([rule("*"),rule("a*".repeat(100)+"z",true)]),longBranch="a".repeat(120);const bounded=await collectGitlab({...t,branch:longBranch},token,async(u,o)=>String(u).includes("/repository/branches/")?json({name:longBranch,protected:true}):hostile(u,o));assert.ok(bounded.checks.every(c=>c.status==="PASS"));
 r=await collectGitlab(t,token,gitlabFetch([{name:"main"}]));assert.equal(r.checks.find(c=>c.id==="force-push")!.status,"UNKNOWN");assert.equal(r.checks.find(c=>c.id==="direct-push")!.status,"UNKNOWN");
});
test("GitLab rejects wrong projects, incomplete/looping pages and unknown protection access",async()=>{
 const t={projectPath:project.path_with_namespace,branch:"main"};await assert.rejects(()=>collectGitlab(t,token,async()=>json({...project,path_with_namespace:"other/project"})),code("TARGET_MISMATCH"));
 await assert.rejects(()=>collectGitlab(t,token,gitlabFetch(Array.from({length:100},(_,i)=>rule("branch-"+i)))),code("PAGINATION_INCOMPLETE"));
 await assert.rejects(()=>collectGitlab(t,token,gitlabFetch([rule()],{"x-next-page":"3"})),code("PAGINATION_LIMIT"));
 const f=gitlabFetch([]),r=await collectGitlab(t,token,async(u,o)=>String(u).includes("protected_branches")?new Response(null,{status:403}):f(u,o));assert.equal(r.checks.find(c=>c.id==="force-push")!.status,"UNKNOWN");
});
test("Cloudflare verifies exact account/zone before scoped individual setting reads",async()=>{
 const values:Record<string,string>={ssl:"strict",min_tls_version:"1.2",always_use_https:"on",tls_1_3:"on"};let calls=0;
 const f:typeof fetch=async(u,o)=>{calls++;assert.equal(o?.method,"GET");assert.equal(o?.redirect,"error");assert.equal((o?.headers as any).Authorization,"Bearer "+token);assert.ok(String(u).startsWith("https://api.cloudflare.com/client/v4/zones/"+zoneId));const key=String(u).split("/").at(-1)!;return json({success:true,result:key===zoneId?{id:zoneId,account:{id:accountId},name:"discard.example.invalid"}:{id:key,value:values[key]}});};
 let r=await collectCloudflare({zoneId,accountId},token,f);assert.equal(calls,5);assert.ok(r.checks.every(c=>c.status==="PASS"));assert.doesNotMatch(JSON.stringify(r),/discard|Bearer|fictional-read-only/);
 values.ssl="flexible";r=await collectCloudflare({zoneId,accountId},token,f);assert.equal(r.checks[0].status,"FAIL");
 let wrong=0;await assert.rejects(()=>collectCloudflare({zoneId,accountId},token,async()=>{wrong++;return json({success:true,result:{id:zoneId,account:{id:"c".repeat(32)}}});}),code("TARGET_MISMATCH"));assert.equal(wrong,1);
});
test("Cloudflare missing settings stay unknown and provider errors never become a pass",async()=>{
 const first={success:true,result:{id:zoneId,account:{id:accountId}}};let calls=0;
 const r=await collectCloudflare({zoneId,accountId},token,async()=>++calls===1?json(first):new Response(null,{status:404}));assert.ok(r.checks.every(c=>c.status==="UNKNOWN"));
 calls=0;await assert.rejects(()=>collectCloudflare({zoneId,accountId},token,async()=>++calls===1?json(first):json({success:false,result:{id:"ssl",value:"strict"}})),code("INVALID_RESPONSE"));
});
const profile={company_number:"SC123456",company_name:"Fictional Supplier Ltd",company_status:"active",accounts:{next_accounts:{overdue:false}},confirmation_statement:{overdue:false},has_insolvency_history:false,registered_office_address:{address_line_1:"DO NOT RETAIN"}};
test("Companies House verifies the company number, retains only indicators and uses non-deprecated filing fields",async()=>{
 const target={companyNumber:"SC123456"};const r=await collectCompaniesHouse(target,token,async(u,o)=>{assert.equal(u,"https://api.company-information.service.gov.uk/company/SC123456");assert.equal(o?.method,"GET");assert.equal(o?.redirect,"error");assert.equal((o?.headers as any).Authorization,"Basic "+Buffer.from(token+":").toString("base64"));return json(profile);});assert.ok(r.checks.every(c=>c.status==="PASS"));assert.doesNotMatch(JSON.stringify(r),/DO NOT RETAIN|registered_office|fictional-read-only/);
 const changed=await collectCompaniesHouse(target,token,async()=>json({...profile,accounts:{overdue:false},company_status:"administration",confirmation_statement:{}}));assert.equal(changed.checks.find(c=>c.id==="accounts-overdue")!.status,"UNKNOWN");assert.equal(changed.checks.find(c=>c.id==="company-status")!.status,"FAIL");assert.equal(changed.checks.find(c=>c.id==="confirmation-overdue")!.status,"UNKNOWN");
 await assert.rejects(()=>collectCompaniesHouse(target,token,async()=>json({...profile,company_number:"12345678"})),code("TARGET_MISMATCH"));
});
test("extended collectors bound payloads, reject credentials/targets and sanitize provider failures",async()=>{
 const target={companyNumber:"SC123456"};await assert.rejects(()=>collectCompaniesHouse(target,token,async()=>new Response(null,{status:429})),code("RATE_LIMITED"));
 await assert.rejects(()=>collectCompaniesHouse(target,token,async()=>new Response("not json",{headers:{"content-type":"application/json"}})),code("INVALID_RESPONSE"));
 await assert.rejects(()=>collectCompaniesHouse(target,token,async()=>json({...profile,padding:"x".repeat(262145)})),code("RESPONSE_TOO_LARGE"));
 for(const t of ["http://127.0.0.1/","SC123456/../secret"])await assert.rejects(()=>collectCompaniesHouse({companyNumber:t},token,async()=>assert.fail("no request")),code("INVALID_TARGET"));
 await assert.rejects(()=>collectCloudflare({zoneId,accountId},"bad\ncredential",async()=>assert.fail("no request")),code("INVALID_TARGET"));
 const moved=json(profile);Object.defineProperty(moved,"url",{value:"https://example.invalid/"});await assert.rejects(()=>collectCompaniesHouse(target,token,async()=>moved),code("TARGET_MISMATCH"));
});
test("all additional providers remain disabled before any request",async()=>{
 process.env.REGPILOT_CONNECTORS_ENABLED="false";
 for(const provider of ["GITLAB","CLOUDFLARE","COMPANIES_HOUSE"])await assert.rejects(()=>collectConfiguredConnector({provider,repository:"invalid",branch:"invalid"},token),code("PROVIDER_DISABLED"));
});
