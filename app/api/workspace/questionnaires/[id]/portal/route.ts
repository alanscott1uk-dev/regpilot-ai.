import {context,readBody,reply,fail,validId} from '../../../../../../lib/server/operations-http';
import {issuePortalHandoff} from '../../../../../../lib/server/portal-handoff';
export const dynamic='force-dynamic';
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){try{return reply(await issuePortalHandoff(await context(req,new URL(req.url).searchParams.get('organizationId'),true),validId((await params).id),await readBody(req,1_100_000)),201);}catch(e){return fail(e);}}
