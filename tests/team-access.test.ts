import test from "node:test";
import assert from "node:assert/strict";
import {mayManageRole} from "../lib/team-policy";
import {invitationSchema,memberChangeSchema} from "../lib/server/team-inputs";
import {GET,POST,PATCH,DELETE} from "../app/api/workspace/team/route";
import {GET as INBOX,POST as ACCEPT} from "../app/api/workspace/invitations/route";
import {verifyAiIdentity} from "../lib/server/ai-auth";
const id="123e4567-e89b-42d3-a456-426614174000";
const request=(method="POST",data:unknown={organizationId:id})=>new Request("https://example.invalid?organizationId="+id,{method,headers:{"content-type":"application/json"},...(method==="GET"?{}:{body:JSON.stringify(data)})});
test("team role policy does not let administrators promote peers or create owners",()=>{
 for(const role of ["OWNER","ADMIN","EDITOR","VIEWER"])assert.equal(mayManageRole(role,"OWNER"),false);
 assert.equal(mayManageRole("OWNER","ADMIN"),true);assert.equal(mayManageRole("ADMIN","ADMIN"),false);
 assert.equal(mayManageRole("ADMIN","EDITOR","ADMIN"),false);assert.equal(mayManageRole("ADMIN","VIEWER","EDITOR"),true);
 assert.equal(mayManageRole("EDITOR","VIEWER"),false);assert.equal(mayManageRole("VIEWER","EDITOR"),false);
 assert.equal(invitationSchema.parse({email:"  Alice@Example.invalid ",role:"EDITOR"}).email,"alice@example.invalid");
 assert.equal(invitationSchema.safeParse({email:"alice@example.invalid",role:"OWNER"}).success,false);
 assert.equal(invitationSchema.safeParse({email:"alice@example.invalid",role:"EDITOR",externalId:id}).success,false);
 assert.equal(memberChangeSchema.safeParse({userId:id,expectedRole:"EDITOR",action:"ROLE",role:"OWNER"}).success,false);
});
test("team APIs fail closed and do not accept caller-supplied identity",async()=>{
 process.env.REGPILOT_WORKSPACE_ENABLED="false";
 for(const r of [await GET(request("GET")),await POST(request()),await PATCH(request("PATCH")),await DELETE(request("DELETE")),await INBOX(request("GET")),await ACCEPT(request())]){assert.equal(r.status,503);assert.equal(r.headers.get("cache-control"),"no-store");}
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:"true",DATABASE_URL:"postgresql://unused:unused@127.0.0.1:1/unused",SUPABASE_URL:"https://example.invalid",SUPABASE_PUBLISHABLE_KEY:"fixture",REGPILOT_AI_ALLOWED_EMAILS:"alice@example.invalid"});
 for(const r of [await GET(request("GET")),await POST(request()),await PATCH(request("PATCH")),await DELETE(request("DELETE")),await INBOX(request("GET")),await ACCEPT(request("POST",{externalId:id,email:"alice@example.invalid"}))])assert.equal(r.status,401);
 assert.equal((await POST(request("POST",{organizationId:id,extra:"x".repeat(3000)}))).status,413);
 assert.equal((await GET(new Request("https://example.invalid?organizationId=no"))).status,400);
});
test("invitation identity comes from the verified provider, not editable metadata",async()=>{
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:"true",DATABASE_URL:"postgresql://unused:unused@127.0.0.1:1/unused",SUPABASE_URL:"https://example.invalid",SUPABASE_PUBLISHABLE_KEY:"fixture",REGPILOT_AI_ALLOWED_EMAILS:"alice@example.invalid"});
 const original=globalThis.fetch,req=new Request("https://example.invalid",{headers:{authorization:"Bearer "+"a".repeat(40)}});
 try{
  globalThis.fetch=async()=>Response.json({id,email:"alice@example.invalid",aud:"authenticated",email_confirmed_at:null,user_metadata:{email_verified:true,role:"OWNER"}});
  await assert.rejects(()=>verifyAiIdentity(req),(e:any)=>e.status===401);
  globalThis.fetch=async()=>Response.json({id,email:"other@example.invalid",aud:"authenticated",email_confirmed_at:"2026-01-01",user_metadata:{email:"alice@example.invalid"}});
  await assert.rejects(()=>verifyAiIdentity(req),(e:any)=>e.status===403);
  globalThis.fetch=async()=>Response.json({id,email:"alice@example.invalid",aud:"authenticated",email_confirmed_at:"2026-01-01",user_metadata:{role:"OWNER"}});
  assert.deepEqual(await verifyAiIdentity(req),{externalId:id,email:"alice@example.invalid"});
 }finally{globalThis.fetch=original;}
});
