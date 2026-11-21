import {verifyAiIdentity} from "../../../../lib/server/ai-auth";
import {reply,fail,readBody,validId} from "../../../../lib/server/operations-http";
import {openAuditRoom,guestAuditAction} from "../../../../lib/server/auditor-service";
export const runtime="nodejs";export const dynamic="force-dynamic";
type Params={params:Promise<{id:string}>};
export async function GET(request:Request,{params}:Params){try{const identity=await verifyAiIdentity(request);return reply(await openAuditRoom(identity,validId((await params).id)));}catch(e){return fail(e);}}
export async function POST(request:Request,{params}:Params){try{const identity=await verifyAiIdentity(request);return reply(await guestAuditAction(identity,validId((await params).id),await readBody(request,5000)));}catch(e){return fail(e);}}
