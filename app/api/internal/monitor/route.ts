import {workspaceConfigured} from "../../../../lib/server/ai-auth";
import {monitoringEnabled,validMonitorSecret,runMonitoringBatch} from "../../../../lib/server/monitoring-service";
import {reply} from "../../../../lib/server/intelligence-http";
export const runtime="nodejs";export const dynamic="force-dynamic";export const maxDuration=60;
export async function POST(request:Request){
  if(!workspaceConfigured()||!monitoringEnabled())return reply({error:"Scheduled monitoring is disabled"},503);
  if(!validMonitorSecret(request))return reply({error:"Unauthorised"},401);
  try{return reply(await runMonitoringBatch());}
  catch{return reply({error:"Monitoring worker unavailable"},503);}
}
