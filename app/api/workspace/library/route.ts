import {libraryWorkspace} from "../../../../lib/server/library-service";
import {coverageAiEnabled} from "../../../../lib/server/coverage-service";
import {context,reply,fail,validId} from "../../../../lib/server/operations-http";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request){try{const p=new URL(request.url).searchParams,ctx=await context(request,p.get("organizationId"));return reply({...await libraryWorkspace(ctx,{cursor:p.get("cursor")?validId(p.get("cursor")):"",revisionId:p.get("revisionId")?validId(p.get("revisionId")):"",search:(p.get("search")||"").slice(0,100)}),aiEnabled:coverageAiEnabled()});}catch(e){return fail(e);}}
