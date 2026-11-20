import {context,reply,fail,validId} from '../../../../../../../lib/server/operations-http';
import {downloadOcrOriginal} from '../../../../../../../lib/server/ocr-service';
import {verifiedDownloadResponse} from '../../../../../../../lib/server/verified-download';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=30;
type Params={params:Promise<{id:string}>};
export async function GET(request:Request,p:Params){try{const params=new URL(request.url).searchParams;if(params.getAll('organizationId').length!==1)return reply({error:'Choose one organisation'},400);const c=await context(request,params.get('organizationId'),true),result=await downloadOcrOriginal(c,validId((await p.params).id));return verifiedDownloadResponse(()=>result.bytes,{filename:result.filename,contentType:result.contentType,signal:request.signal});}catch(error){return fail(error);}}
