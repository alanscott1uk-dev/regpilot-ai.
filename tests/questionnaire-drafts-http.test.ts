import test from "node:test";import assert from "node:assert/strict";import {randomUUID} from "node:crypto";
import {GET,POST} from "../app/api/workspace/questionnaires/[id]/drafts/route";
import {PATCH} from "../app/api/workspace/questionnaires/[id]/drafts/[runId]/route";
test("private questionnaire draft routes fail closed before parsing or accessing an unauthenticated request",async()=>{
 const id=randomUUID(),runId=randomUUID(),request=new Request("https://example.invalid/api/workspace/questionnaires/"+id+"/drafts?organizationId="+randomUUID()),params={params:Promise.resolve({id,runId})};process.env.REGPILOT_WORKSPACE_ENABLED="false";
 for(const fn of [GET,POST,PATCH]){const result=await fn(request,params);assert.equal(result.status,503);assert.equal(result.headers.get("cache-control"),"no-store");}
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:"true",REGPILOT_AI_ALLOWED_EMAILS:"fictional@example.invalid",DATABASE_URL:"postgresql://unused:unused@127.0.0.1:1/unused",SUPABASE_URL:"https://example.invalid",SUPABASE_PUBLISHABLE_KEY:"fixture"});
 for(const fn of [GET,POST,PATCH])assert.equal((await fn(request,params)).status,401);
});
