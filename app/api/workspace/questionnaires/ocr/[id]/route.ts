import {context,reply,fail,readBody,validId} from '../../../../../../lib/server/operations-http';
import {ocrDetail,changeOcrSource} from '../../../../../../lib/server/ocr-service';
import {OCR_LIMITS} from '../../../../../../lib/ocr';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
type Params={params:Promise<{id:string}>};
export async function GET(request:Request,p:Params){try{const params=new URL(request.url).searchParams;if(params.getAll('organizationId').length!==1)return reply({error:'Choose one organisation'},400);const c=await context(request,params.get('organizationId'),true);return reply(await ocrDetail(c,validId((await p.params).id)));}catch(error){return fail(error);}}
export async function PATCH(request:Request,p:Params){try{const params=new URL(request.url).searchParams;if(params.getAll('organizationId').length!==1)return reply({error:'Choose one organisation'},400);const c=await context(request,params.get('organizationId'),true);return reply(await changeOcrSource(c,validId((await p.params).id),await readBody(request,OCR_LIMITS.requestBytes)));}catch(error){return fail(error);}}
