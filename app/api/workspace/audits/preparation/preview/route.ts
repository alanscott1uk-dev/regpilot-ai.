import {context,reply,fail,readBody} from "../../../../../../lib/server/operations-http";
import {previewAuditPreparation} from "../../../../../../lib/server/audit-preparation-service";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function POST(r:Request){try{const c=await context(r,new URL(r.url).searchParams.get("organizationId"),true);return reply(await previewAuditPreparation(c,await readBody(r,4000)));}catch(e){return fail(e);}}
