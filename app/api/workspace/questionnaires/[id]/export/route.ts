import {context,reply,fail,validId} from "../../../../../../lib/server/operations-http";
import {exportQuestionnaire} from "../../../../../../lib/server/customer-assurance-service";
export const runtime="nodejs";export const dynamic="force-dynamic";export const maxDuration=60;
export async function GET(r:Request,p:{params:Promise<{id:string}>}){try{const c=await context(r,new URL(r.url).searchParams.get("organizationId"),true),value=await exportQuestionnaire(c,validId((await p.params).id));return new Response(value.csv,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":"attachment; filename=questionnaire.csv","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});}catch(e){return fail(e);}}
