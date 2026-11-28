import {context,fail,validId} from "../../../../../../lib/server/operations-http";
import {exportAuditArchive} from "../../../../../../lib/server/auditor-service";
export const runtime="nodejs";export const dynamic="force-dynamic";export const maxDuration=60;
export async function GET(r:Request,p:{params:Promise<{id:string}>}){try{const c=await context(r,new URL(r.url).searchParams.get("organizationId"),true),bytes=await exportAuditArchive(c,validId((await p.params).id));return new Response(new Uint8Array(bytes),{headers:{"Content-Type":"application/zip","Content-Disposition":"attachment; filename=audit-evidence-package.zip","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});}catch(e){return fail(e);}}
