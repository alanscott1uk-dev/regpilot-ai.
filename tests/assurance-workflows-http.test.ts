import test from "node:test";
import assert from "node:assert/strict";
import {GET as POLICIES,POST as CREATE_POLICY} from "../app/api/workspace/policies/route";
import {GET as POLICY,PATCH as CHANGE_POLICY} from "../app/api/workspace/policies/[id]/route";
import {GET as INBOX} from "../app/api/workspace/policy-inbox/route";
import {POST as ACK} from "../app/api/workspace/policy-inbox/[id]/route";
import {GET as FILE} from "../app/api/workspace/policy-inbox/[id]/file/route";
import {GET as VENDORS,POST as CREATE_VENDOR} from "../app/api/workspace/vendors/route";
import {GET as VENDOR,PATCH as CHANGE_VENDOR} from "../app/api/workspace/vendors/[id]/route";
import {POST as REVIEW} from "../app/api/workspace/vendors/[id]/reviews/route";
import {GET as EXPORT_VENDOR} from "../app/api/workspace/vendors/[id]/export/route";
const id="123e4567-e89b-42d3-a456-426614174000",params={params:Promise.resolve({id})};
const request=()=>new Request("https://example.invalid?organizationId="+id,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({userId:id,role:"OWNER",filler:"x".repeat(22000)})});
const calls=()=>[()=>EXPORT_VENDOR(request(),params),()=>POLICIES(request()),()=>CREATE_POLICY(request()),()=>POLICY(request(),params),()=>CHANGE_POLICY(request(),params),()=>INBOX(request()),()=>ACK(request(),params),()=>FILE(request(),params),()=>VENDORS(request()),()=>CREATE_VENDOR(request()),()=>VENDOR(request(),params),()=>CHANGE_VENDOR(request(),params),()=>REVIEW(request(),params)];
test("every policy and supplier route fails closed before activation and does not cache private responses",async()=>{
 process.env.REGPILOT_WORKSPACE_ENABLED="false";
 for(const call of calls()){const r=await call();assert.equal(r.status,503);assert.equal(r.headers.get("cache-control"),"no-store");assert.equal(r.headers.get("x-content-type-options"),"nosniff");}
});
test("policy and supplier routes authenticate before reading oversized forged bodies",async()=>{
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:"true",DATABASE_URL:"postgresql://unused:unused@127.0.0.1:1/unused",SUPABASE_URL:"https://example.invalid",SUPABASE_PUBLISHABLE_KEY:"fixture",REGPILOT_AI_ALLOWED_EMAILS:"fixture@example.invalid"});
 for(const call of calls())assert.equal((await call()).status,401);
});
