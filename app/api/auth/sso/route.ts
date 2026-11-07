import {approvedSsoDomain} from "../../../../lib/services/sso";
import {serviceReady} from "../../../../lib/services/config";
import {workspaceConfigured} from "../../../../lib/server/ai-auth";
import {readBody,reply,failure} from "../../../../lib/server/intelligence-http";
export async function GET(){return reply({enabled:workspaceConfigured()&&serviceReady("SSO")});}
export async function POST(request:Request){if(!workspaceConfigured()||!serviceReady("SSO"))return reply({error:"Company sign-in awaits activation"},503);try{const b=await readBody(request,1024),approved=approvedSsoDomain(b.domain);return approved?reply(approved):reply({error:"Company sign-in is unavailable for this domain"},403);}catch(e){return failure(e);}}
