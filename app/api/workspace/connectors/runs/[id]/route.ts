import {exportConnectorRun} from "../../../../../../lib/server/connector-service";
import {context,reply,fail,validId} from "../../../../../../lib/server/operations-http";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request,args:{params:Promise<{id:string}>}){try{const ctx=await context(request,new URL(request.url).searchParams.get("organizationId"));const r=reply(await exportConnectorRun(ctx,validId((await args.params).id)));r.headers.set("Content-Disposition",'attachment; filename="regpilot-connector-observation.json"');return r;}catch(e){return fail(e);}}
