import {context,reply,fail,readBody,validId} from '../../../../../../../lib/server/operations-http';
import {replayIntegrationDelivery} from '../../../../../../../lib/server/integration-delivery-service';
export const runtime='nodejs',dynamic='force-dynamic';
export async function POST(request:Request,args:{params:Promise<{id:string}>}){try{const ctx=await context(request,new URL(request.url).searchParams.get('organizationId'),true);return reply(await replayIntegrationDelivery(ctx,validId((await args.params).id),await readBody(request)));}catch(error){return fail(error);}}
