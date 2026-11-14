import {verifyAiIdentity} from "../../../../lib/server/ai-auth";
import {invitationInbox,decideInvitation} from "../../../../lib/server/team-service";
import {reply,fail,readBody} from "../../../../lib/server/operations-http";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request){try{const identity=await verifyAiIdentity(request);return reply({invitations:await invitationInbox(identity)});}catch(e){return fail(e);}}
export async function POST(request:Request){try{const identity=await verifyAiIdentity(request),body=await readBody(request,1024);return reply(await decideInvitation(identity,body));}catch(e){return fail(e);}}
