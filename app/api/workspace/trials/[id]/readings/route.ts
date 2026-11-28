import {context,reply,fail} from '../../../../../../lib/server/operations-http';
import {operatorReceiptOptions} from '../../../../../../lib/server/capability-trial-service';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const query=new URL(request.url).searchParams;
  return reply(await operatorReceiptOptions(await context(request,query.get('organizationId')),(await params).id,query.get('before')??undefined));
 }catch(error){return fail(error);}
}
