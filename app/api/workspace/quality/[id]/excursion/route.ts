import {context,fail,readBody,reply,validId} from '../../../../../../lib/server/operations-http';
import {excursionWorkspace,excursionCommand} from '../../../../../../lib/server/excursion-pilot';
export const runtime='nodejs',dynamic='force-dynamic';
type Args={params:Promise<{id:string}>};
export async function GET(r:Request,{params}:Args){try{
 const c=await context(r,new URL(r.url).searchParams.get('organizationId'));
 return reply(await excursionWorkspace(c,validId((await params).id)));
}catch(e){return fail(e);}}
export async function POST(r:Request,{params}:Args){try{
 const c=await context(r,new URL(r.url).searchParams.get('organizationId'));
 return reply(await excursionCommand(c,validId((await params).id),await readBody(r,16000)));
}catch(e){return fail(e);}}
