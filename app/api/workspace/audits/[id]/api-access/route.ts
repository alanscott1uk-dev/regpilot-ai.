import {context,fail,readBody,reply,validId} from "../../../../../../lib/server/operations-http";
import {manageAuditorKey} from "../../../../../../lib/server/auditor-api";
export const runtime="nodejs", dynamic="force-dynamic";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const ctx=await context(request,new URL(request.url).searchParams.get("organizationId"),true);
    return reply(await manageAuditorKey(ctx,validId((await params).id),await readBody(request)));
  }catch(error){return fail(error);}
}
