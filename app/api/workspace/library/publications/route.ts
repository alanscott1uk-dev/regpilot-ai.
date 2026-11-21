import {discoverPublications,registerPublication,requireLibrary,workspaceCatalogue} from "../../../../../lib/server/publication-catalogue";
import {transaction} from "../../../../../lib/server/intelligence-service";
import {requireMember,WRITER} from "../../../../../lib/server/workspace-member";
import {context,reply,fail,readBody} from "../../../../../lib/server/operations-http";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request){try{const p=new URL(request.url).searchParams,ctx=await context(request,p.get("organizationId"));await transaction(ctx,tx=>requireMember(tx,ctx,p.has("q")?WRITER:undefined));if(!p.has("q"))return reply({items:await workspaceCatalogue(ctx)});requireLibrary();return reply(await discoverPublications(p.get("q")||"",Number(p.get("offset")||0)));}catch(e){return fail(e);}}
export async function POST(request:Request){try{const body=await readBody(request),ctx=await context(request,body.organizationId,true);return reply(await registerPublication(ctx,body),201);}catch(e){return fail(e);}}
