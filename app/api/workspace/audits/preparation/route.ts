import {context,reply,fail,readBody} from "../../../../../lib/server/operations-http";
import {applyAuditPreparation} from "../../../../../lib/server/audit-preparation-service";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function POST(r:Request){try{const c=await context(r,new URL(r.url).searchParams.get("organizationId"),true);return reply(await applyAuditPreparation(c,await readBody(r,10000)),201);}catch(e){return fail(e);}}
