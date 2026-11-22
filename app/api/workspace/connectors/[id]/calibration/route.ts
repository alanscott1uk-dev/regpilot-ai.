import {approveLoggerCalibration} from '../../../../../../lib/server/logger-calibration';
import {context,readBody,reply,fail,validId} from '../../../../../../lib/server/operations-http';
export const runtime='nodejs';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const body=await readBody(request);
  const ctx=await context(request,body.organizationId,true);
  return reply(await approveLoggerCalibration(ctx,validId((await params).id),Number(body.version),body.confirm));
 }catch(error){return fail(error);}
}
