import {changeConnectorControl} from '../../../../../../lib/server/connector-control-service';
import {context,reply,fail,readBody,validId} from '../../../../../../lib/server/operations-http';
export const runtime='nodejs';
export async function PATCH(request:Request,args:{params:Promise<{id:string}>}){try{
 const body=await readBody(request),ctx=await context(request,body.organizationId,true),id=validId((await args.params).id);
 return reply(await changeConnectorControl(ctx,id,body));
}catch(e){return fail(e);}}
