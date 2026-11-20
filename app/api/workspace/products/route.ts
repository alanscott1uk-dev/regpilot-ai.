import {context,reply,fail,readBody,validId} from '../../../../lib/server/operations-http';
import {productWorkspace,createProduct} from '../../../../lib/server/product-service';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request){try{const p=new URL(request.url).searchParams;if(p.getAll('organizationId').length!==1||p.getAll('requestKey').length>1)return reply({error:'Choose one company and one operation'},400);return reply(await productWorkspace(await context(request,p.get('organizationId')),p.has('requestKey')?validId(p.get('requestKey')):undefined));}catch(error){return fail(error);}}
export async function POST(request:Request){try{const p=new URL(request.url).searchParams;if(p.getAll('organizationId').length!==1)return reply({error:'Choose one company'},400);return reply(await createProduct(await context(request,p.get('organizationId'),true),await readBody(request,12000)),201);}catch(error){return fail(error);}}
