import {context,reply,fail,validId} from "../../../../../../lib/server/operations-http";
import {exportAuditPackage} from "../../../../../../lib/server/auditor-service";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){try{const ctx=await context(request,new URL(request.url).searchParams.get("organizationId"),true),id=validId((await params).id);return new Response(JSON.stringify(await exportAuditPackage(ctx,id),null,2),{headers:{"Content-Type":"application/json","Content-Disposition":'attachment; filename="audit-package-index.json"',"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});}catch(e){return fail(e);}}
