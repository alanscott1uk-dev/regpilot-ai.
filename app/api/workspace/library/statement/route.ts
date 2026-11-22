import {applicabilityStatementPage} from '../../../../../lib/server/applicability-statement';
import {saveLibrarySite} from '../../../../../lib/server/library-sites';
import {context,fail,reply,readBody} from '../../../../../lib/server/operations-http';
export const runtime='nodejs',dynamic='force-dynamic';
export async function GET(request:Request){
  try{
    const p=new URL(request.url).searchParams,ctx=await context(request,p.get('organizationId'));
    return reply(await applicabilityStatementPage(ctx,{on:p.get('on')??undefined,collection:p.get('collection')??'',offset:Number(p.get('offset')??0),inventory:p.get('inventory')??undefined}));
  }catch(e){return fail(e);}
}

export async function POST(request:Request){
  try{
    const {organizationId,...input}=await readBody(request,4096);
    const ctx=await context(request,organizationId,true);
    return reply(await saveLibrarySite(ctx,input));
  }catch(e){return fail(e);}
}
