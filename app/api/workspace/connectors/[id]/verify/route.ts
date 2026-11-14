import {verifyConnectorNow} from "../../../../../../lib/server/connector-service";
import {context,readBody,reply,fail,validId} from "../../../../../../lib/server/operations-http";
import {IntelligenceError} from "../../../../../../lib/server/intelligence-service";
export const runtime="nodejs";export const dynamic="force-dynamic";export const maxDuration=120;
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const body=await readBody(request);
  const ctx=await context(request,body.organizationId,true);
  const id=validId((await params).id);
  if(!Number.isInteger(body.version)||Number(body.version)<1)throw new IntelligenceError("Invalid connector version");
  return reply(await verifyConnectorNow(ctx,id,Number(body.version)));
 }catch(error){return fail(error);}
}
