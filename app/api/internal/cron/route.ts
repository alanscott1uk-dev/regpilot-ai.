import {validCronSecret,executeScheduledTick} from "../../../../lib/cron-tick.mjs";
import {workspaceConfigured} from "../../../../lib/server/ai-auth";
import {monitoringEnabled,runMonitoringBatch} from "../../../../lib/server/monitoring-service";
import {connectorsEnabled,runConnectorBatch} from "../../../../lib/server/connector-service";
import {runReviewBatch} from "../../../../lib/server/control-service";
import {reply} from "../../../../lib/server/intelligence-http";
import {runAutomationBatch} from "../../../../lib/server/automation-queue";

export const runtime="nodejs";export const dynamic="force-dynamic";export const maxDuration=120;
export async function GET(request:Request){
 // Vercel delivers CRON_SECRET as a bearer token. No user session or public API key is accepted.
 if(!validCronSecret(request.headers.get("authorization"),process.env.CRON_SECRET))return reply({error:"Unauthorised"},401);
 if(!workspaceConfigured()||process.env.REGPILOT_CRON_ENABLED!=="true"||process.env.REGPILOT_AUTOMATION_ENABLED!=="true")
  return reply({error:"Scheduled production automation awaits verified activation"},503);
 const jobs={
  ...(monitoringEnabled()?{sources:()=>runMonitoringBatch(12,3)}:{}),
  ...(connectorsEnabled()?{connectors:()=>runConnectorBatch(4,2),automations:()=>runAutomationBatch()}:{}),
  controlReviews:runReviewBatch
 };
 try{
  const result=await executeScheduledTick(jobs);
  return reply({...result,checkedAt:new Date().toISOString()},result.ok?200:503);
 }catch{
  return reply({error:"Scheduled worker failed",ok:false},503);
 }
}
