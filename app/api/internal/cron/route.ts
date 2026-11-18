import {validCronSecret} from "../../../../lib/cron-tick.mjs";
import {cronEnabled,runCronWorker} from "../../../../lib/server/worker-runtime";
import {reply} from "../../../../lib/server/intelligence-http";

export const runtime="nodejs";export const dynamic="force-dynamic";export const maxDuration=120;
export async function GET(request:Request){
 // Vercel delivers CRON_SECRET as a bearer token. No user session or public API key is accepted.
 if(!validCronSecret(request.headers.get("authorization"),process.env.CRON_SECRET))return reply({error:"Unauthorised"},401);
 if(!cronEnabled())
  return reply({error:"Scheduled production automation awaits verified activation"},503);
 try{
  const result=await runCronWorker();
  return reply({...result.body,checkedAt:new Date().toISOString()},result.status);
 }catch{
  return reply({error:"Scheduled worker failed",ok:false},503);
 }
}
