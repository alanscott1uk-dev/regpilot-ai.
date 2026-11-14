import {context,fail,validId} from "../../../../../../lib/server/operations-http";
import {exportChangeResponse} from "../../../../../../lib/server/change-response-service";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(r:Request,p:{params:Promise<{id:string}>}){try{const ctx=await context(r,new URL(r.url).searchParams.get("organizationId"),true);return new Response(JSON.stringify(await exportChangeResponse(ctx,validId((await p.params).id)),null,2),{headers:{"Content-Type":"application/json","Content-Disposition":'attachment; filename="change-response-record.json"',"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});}catch(e){return fail(e);}}
