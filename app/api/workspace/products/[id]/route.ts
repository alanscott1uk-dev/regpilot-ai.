import {context,reply,fail,readBody,validId} from '../../../../../lib/server/operations-http';
import {changeProduct} from '../../../../../lib/server/product-service';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){try{const p=new URL(request.url).searchParams;if(p.getAll('organizationId').length!==1)return reply({error:'Choose one company'},400);return reply(await changeProduct(await context(request,p.get('organizationId'),true),validId((await params).id),await readBody(request,12000)));}catch(error){return fail(error);}}
