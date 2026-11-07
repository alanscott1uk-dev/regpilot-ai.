/**
 * Offline private-pilot smoke checks against an already-built local Next.js app.
 * Does NOT use Vercel, Supabase, third-party APIs, or any billable AI model.
 * Always forces workspace/AI feature flags off while running.
 */
import {spawn} from "node:child_process";
import {createServer} from "node:net";
import {setTimeout as sleep} from "node:timers/promises";
import assert from "node:assert/strict";

async function unusedPort(){
 return await new Promise((resolve,reject)=>{
  const server=createServer();
  server.on("error",reject);
  server.listen(0,"127.0.0.1",()=>{
   const addr=server.address();
   const port=typeof addr==="object"&&addr?addr.port:0;
   server.close(()=>resolve(port));
  });
 });
}
const port=await unusedPort();
const root="http://127.0.0.1:"+port;
let log="";
const server=spawn(process.execPath,["node_modules/next/dist/bin/next","start","-H","127.0.0.1","-p",String(port)],{
 env:{
  ...process.env,
  NODE_ENV:"production",
  REGPILOT_PAID_SERVICES_ENABLED:"false",
  REGPILOT_AI_ENABLED:"false",
  REGPILOT_SEMANTIC_ENABLED:"false",
  REGPILOT_MONITORING_ENABLED:"false",
  REGPILOT_WORKSPACE_ENABLED:"false",
  REGPILOT_PROGRAMME_ENABLED:"false",
  REGPILOT_LIBRARY_ENABLED:"false",
  REGPILOT_LIBRARY_AI_ENABLED:"false",
  REGPILOT_PROGRAMME_AI_ENABLED:"false",
  REGPILOT_CONNECTORS_ENABLED:"false",
  REGPILOT_AUTOMATION_ENABLED:"false",
  REGPILOT_MONITOR_SECRET:"",
  AI_GATEWAY_API_KEY:"",
  VERCEL_OIDC_TOKEN:"",
  NEXT_TELEMETRY_DISABLED:"1"
 },
 stdio:["ignore","pipe","pipe"]
});
for(const stream of [server.stdout,server.stderr])stream?.on("data",chunk=>{
 log=(log+String(chunk)).slice(-3500);
});
async function response(path,options={}){
 const signal=AbortSignal.timeout(6000);
 return fetch(root+path,{redirect:"manual",cache:"no-store",signal,...options});
}
async function waitForServer(){
 for(let i=0;i<65;i++){
  if(server.exitCode!==null)throw new Error("Next.js exited early: "+log);
  try{const res=await response("/api/health");if(res.status<500)return}catch{}
  await sleep(280);
 }
 throw new Error("Local Next.js startup timed out: "+log);
}
try{
 await waitForServer();
 const routes=[
  "/team/access-reviews","/team/answers","/team/questionnaires","/team/trust","/trust","/team/audit-requests","/team/changes","/team/people","/team/vendors","/team/audits","/auditor","/team/services","/team/settings","/team/operations","/team/library","/workbench","/register","/documents","/evidence","/controls",
  "/assurance","/intelligence","/traceability","/team","/team/evidence","/team/sources","/team/intelligence","/team/assurance","/ai"
 ];
 for(const path of routes){
  const res=await response(path);
  assert.equal(res.status,200,path+" should render successfully");
  assert.match(res.headers.get("content-type")||"",/text\/html/,path+" should be a page");
  const text=await res.text();
  assert.ok(text.includes("RegPilot"),path+" should render RegPilot content");
 }
 const status=await response("/api/ai/analyse");
 assert.equal(status.status,200,"read-only AI configuration endpoint");
 const config=await status.json();
 assert.equal(config.enabled,false,"billable AI must remain disabled");
 assert.equal(config.workspaceEnabled,false,"private workspace must remain disabled");
 const noAi=await response("/api/ai/analyse",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
 assert.equal(noAi.status,503,"unauthenticated AI generation must fail closed");
 const noReview=await response("/api/ai/reviews?organizationId=123e4567-e89b-42d3-a456-426614174000");
 assert.equal(noReview.status,503,"private AI review access must fail closed");
 const noEvidence=await response("/api/workspace/evidence?organizationId=123e4567-e89b-42d3-a456-426614174000&obligationId=123e4567-e89b-42d3-a456-426614174001");
 assert.equal(noEvidence.status,503,"evidence API must fail closed without private storage and antivirus configuration");
 const noSources=await response("/api/workspace/sources?organizationId=123e4567-e89b-42d3-a456-426614174000");
 assert.equal(noSources.status,503,"team regulatory source API must fail closed when private workspace is disabled");
 for(const path of ["/api/workspace/operations","/api/workspace/programme","/api/workspace/connectors","/api/workspace/controls","/api/workspace/assurance","/api/workspace/intelligence","/api/workspace/intelligence/profile","/api/workspace/intelligence/semantic","/api/workspace/intelligence/monitoring","/api/internal/monitor","/api/workspace/intelligence/123e4567-e89b-42d3-a456-426614174000"]){
   const method=(path.endsWith("profile")||path.endsWith("monitoring"))?"PUT":"POST";
   const result=await response(path,{method,headers:{"Content-Type":"application/json"},body:"{}"});
   assert.equal(result.status,503,path+" must fail closed");
 }
 assert.equal((await response("/api/internal/automation",{method:"POST"})).status,401,"automation rejects missing secrets");
 for(const path of ["/api/workspace/team?organizationId=123e4567-e89b-42d3-a456-426614174000","/api/workspace/invitations"]){assert.equal((await response(path)).status,503,"team access fails closed");}
 for(const path of ["/api/workspace/audits?organizationId=123e4567-e89b-42d3-a456-426614174000","/api/auditor","/api/auditor/123e4567-e89b-42d3-a456-426614174000","/api/auditor/123e4567-e89b-42d3-a456-426614174000/evidence/123e4567-e89b-42d3-a456-426614174001"]){assert.equal((await response(path)).status,503,"auditor access fails closed");}
 for(const path of ["/api/workspace/access-reviews","/api/workspace/answers","/api/workspace/questionnaires","/api/workspace/changes","/api/workspace/audit-requests","/api/workspace/policies","/api/workspace/policy-inbox","/api/workspace/vendors"]){assert.equal((await response(path+"?organizationId=123e4567-e89b-42d3-a456-426614174000")).status,503,"policy and supplier access fails closed");}
 const noTeam=await response("/api/workspace/obligations?organizationId=123e4567-e89b-42d3-a456-426614174000");
 assert.equal(noTeam.status,503,"private team API must fail closed");
 const rootResponse=await response("/");
 assert.ok([301,302,303,307,308].includes(rootResponse.status),"root should redirect to main workbench");
 console.log("RegPilot local smoke PASS: "+routes.length+" pages, gated AI routes, private work queue, and root redirect.");
}catch(error){
 console.error("RegPilot local smoke FAILED:",error instanceof Error?error.message:String(error));
 if(log)console.error("Last server output:",log);
 process.exitCode=1;
}finally{
 server.kill("SIGTERM");
 await Promise.race([new Promise(resolve=>server.once("exit",resolve)),sleep(2000)]);
 if(server.exitCode===null)server.kill("SIGKILL");
}
