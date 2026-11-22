import {applicabilityStatementPage} from '../../../../../lib/server/applicability-statement';
import {context,fail,reply} from '../../../../../lib/server/operations-http';
export const runtime='nodejs',dynamic='force-dynamic';
export async function GET(request:Request){
  try{
    const p=new URL(request.url).searchParams,ctx=await context(request,p.get('organizationId'));
    return reply(await applicabilityStatementPage(ctx,{on:p.get('on')??undefined,collection:p.get('collection')??'',offset:Number(p.get('offset')??0),inventory:p.get('inventory')??undefined}));
  }catch(e){return fail(e);}
}
