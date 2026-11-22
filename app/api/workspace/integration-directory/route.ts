import {aiChoice,marketplaceAction} from '../../../../lib/server/integration-marketplace';
import {context,fail,reply,readBody} from '../../../../lib/server/operations-http';
export const runtime='nodejs',dynamic='force-dynamic';
export async function GET(request:Request){
 try{return reply(await aiChoice(await context(request,new URL(request.url).searchParams.get('organizationId'))));}catch(e){return fail(e);}
}
export async function POST(request:Request){
 try{const {organizationId,...input}=await readBody(request,4096);return reply(await marketplaceAction(await context(request,organizationId,true),input));}catch(e){return fail(e);}
}
