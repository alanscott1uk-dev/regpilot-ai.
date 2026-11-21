import {reply,fail,readBody,validId} from '../../../../../lib/server/operations-http';
import {verifyAiIdentity} from '../../../../../lib/server/ai-auth';
import {requestTrustAccess} from '../../../../../lib/server/trust-publication';
export const dynamic='force-dynamic';
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){try{return reply(await requestTrustAccess(await verifyAiIdentity(req),validId((await params).id),await readBody(req,300)));}catch(e){return fail(e);}}
