import {verifyAiIdentity} from "../../../lib/server/ai-auth";
import {reply,fail} from "../../../lib/server/operations-http";
import {auditInbox} from "../../../lib/server/auditor-service";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request){try{return reply({invitations:await auditInbox(await verifyAiIdentity(request))});}catch(e){return fail(e);}}
