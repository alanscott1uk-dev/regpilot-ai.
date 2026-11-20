import {context,fail,validId} from '../../../../../../lib/server/operations-http';
import {openReleaseProcedure} from '../../../../../../lib/server/policy-effectivity-service';
import {verifiedDownloadResponse} from '../../../../../../lib/server/verified-download';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
export async function GET(request:Request,args:{params:Promise<{id:string}>}){try{const ctx=await context(request,new URL(request.url).searchParams.get('organizationId'),true),id=validId((await args.params).id),file=await openReleaseProcedure(ctx,id);return await verifiedDownloadResponse(()=>file.bytes,{filename:'controlled-procedure-'+id+(file.contentType==='application/pdf'?'.pdf':file.contentType==='application/vnd.openxmlformats-officedocument.wordprocessingml.document'?'.docx':'.txt'),contentType:file.contentType,signal:request.signal});}catch(error){return fail(error);}}
