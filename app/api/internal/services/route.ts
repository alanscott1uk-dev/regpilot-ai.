import {validMonitorSecret} from "../../../../lib/server/monitoring-service";
import {paidMaster} from "../../../../lib/services/config";
import {runServiceBatch} from "../../../../lib/server/paid-service";
import {reply} from "../../../../lib/server/intelligence-http";
export const runtime="nodejs";export const maxDuration=120;
export async function POST(request:Request){if(!validMonitorSecret(request))return reply({error:"Unauthorised"},401);if(!paidMaster()||process.env.REGPILOT_AUTOMATION_ENABLED!=="true")return reply({error:"Paid worker awaits activation"},503);try{return reply(await runServiceBatch());}catch{return reply({error:"Paid worker unavailable"},503);}}
