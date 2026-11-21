import {context,reply,fail,readBody} from '../../../../lib/server/operations-http';
import {horizonWorkspace,triageHorizon} from '../../../../lib/server/horizon-service';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request){try{return reply(await horizonWorkspace(await context(request,new URL(request.url).searchParams.get('organizationId'))));}catch(e){return fail(e);}}
export async function POST(request:Request){try{const {organizationId,...input}=await readBody(request,4096);return reply(await triageHorizon(await context(request,organizationId),input));}catch(e){return fail(e);}}
