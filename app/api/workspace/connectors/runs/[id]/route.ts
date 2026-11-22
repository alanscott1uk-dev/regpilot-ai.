import {exportConnectorRun} from "../../../../../../lib/server/connector-service";
import {context,reply,fail,validId} from "../../../../../../lib/server/operations-http";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request,args:{params:Promise<{id:string}>}){try{const params=new URL(request.url).searchParams,ctx=await context(request,params.get("organizationId"));const r=reply(await exportConnectorRun(ctx,validId((await args.params).id),params.has("taskId")?validId(params.get("taskId")!):undefined));r.headers.set("Content-Disposition",'attachment; filename="regpilot-connector-observation.json"');return r;}catch(e){return fail(e);}}
