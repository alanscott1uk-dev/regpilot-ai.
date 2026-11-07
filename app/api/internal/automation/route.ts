import {validMonitorSecret} from "../../../../lib/server/monitoring-service";
import {runConnectorBatch,connectorsEnabled} from "../../../../lib/server/connector-service";
import {runReviewBatch} from "../../../../lib/server/control-service";
import {reply} from "../../../../lib/server/intelligence-http";
export const runtime="nodejs";export const maxDuration=120;
export async function POST(request:Request){if(!validMonitorSecret(request))return reply({error:"Unauthorised"},401);if(process.env.REGPILOT_AUTOMATION_ENABLED!=="true")return reply({error:"Automation awaits activation"},503);try{return reply({reviews:await runReviewBatch(),connectors:connectorsEnabled()?await runConnectorBatch():{processed:0,outcomes:[]}});}catch{return reply({error:"Automation unavailable"},503);}}
