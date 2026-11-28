import {context,reply,fail,readBody,validId} from '../../../../lib/server/operations-http';
import {createIntegrationEndpoint,integrationWorkspace} from '../../../../lib/server/integration-delivery-service';
export const runtime='nodejs',dynamic='force-dynamic';
export async function GET(request:Request){try{const params=new URL(request.url).searchParams,ctx=await context(request,params.get('organizationId'),true),options:Record<string,string>={};for(const key of ['endpointId','deliveryId','requestKey','beforeId'])if(params.has(key)){if(params.getAll(key).length!==1)throw Error('Invalid parameter');options[key]=validId(params.get(key));}return reply(await integrationWorkspace(ctx,options));}catch(error){return fail(error);}}
export async function POST(request:Request){try{const ctx=await context(request,new URL(request.url).searchParams.get('organizationId'),true);return reply(await createIntegrationEndpoint(ctx,await readBody(request,16384)),201);}catch(error){return fail(error);}}
