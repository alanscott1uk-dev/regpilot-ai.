import {context,reply,readBody,fail} from '../../../../lib/server/operations-http';
import {getSetupWorkspace,saveSetupWorkspace} from '../../../../lib/server/setup-service';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request){try{return reply(await getSetupWorkspace(await context(request,new URL(request.url).searchParams.get('organizationId'))));}catch(e){return fail(e);}}
export async function POST(request:Request){try{const {organizationId,...input}=await readBody(request,8192);return reply(await saveSetupWorkspace(await context(request,organizationId,true),input));}catch(e){return fail(e);}}
