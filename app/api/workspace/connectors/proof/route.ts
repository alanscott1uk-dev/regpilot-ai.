import {context,fail,readBody,reply,validId} from '../../../../../lib/server/operations-http';
import {customerSourceProof,declaration,declareSource,proofTargets} from '../../../../../lib/server/customer-source-proof';
export const runtime='nodejs';

export async function GET(request:Request){
 try{
  const params=new URL(request.url).searchParams;
  const ctx=await context(request,params.get('organizationId'),true);
  const id=params.get('connectionId');
  return reply(id?{proof:await customerSourceProof(ctx,validId(id))}:{targets:await proofTargets(ctx)});
 }catch(error){return fail(error);}
}

export async function POST(request:Request){
 try{
  const {organizationId,...fields}=await readBody(request);
  const ctx=await context(request,organizationId,true);
  return reply(await declareSource(ctx,declaration.parse(fields)));
 }catch(error){return fail(error);}
}
