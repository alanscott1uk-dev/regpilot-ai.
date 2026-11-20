import {context,reply,fail,readBody,validId} from '../../../../../../lib/server/operations-http';
import {changeCustomerCredential} from '../../../../../../lib/server/customer-api-service';
export const runtime='nodejs',dynamic='force-dynamic';
export async function PATCH(request:Request,args:{params:Promise<{id:string}>}){try{const ctx=await context(request,new URL(request.url).searchParams.get('organizationId'),true);return reply(await changeCustomerCredential(ctx,validId((await args.params).id),await readBody(request)));}catch(error){return fail(error);}}
