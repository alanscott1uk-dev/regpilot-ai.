import {context,reply,fail,readBody,validId} from '../../../../../../../lib/server/operations-http';
import {reviewCustomerApiObservation} from '../../../../../../../lib/server/customer-api-service';
export const runtime='nodejs',dynamic='force-dynamic';
export async function POST(request:Request,args:{params:Promise<{id:string}>}){try{const ctx=await context(request,new URL(request.url).searchParams.get('organizationId'),true);return reply(await reviewCustomerApiObservation(ctx,validId((await args.params).id),await readBody(request,8192)));}catch(error){return fail(error);}}
