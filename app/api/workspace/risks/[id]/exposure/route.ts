import {context,fail,readBody,reply,validId} from "../../../../../../lib/server/operations-http";
import {lossScenarios,saveLossScenario} from "../../../../../../lib/server/risk-loss-service";

export const runtime="nodejs",dynamic="force-dynamic";
type RouteArgs = {params:Promise<{id:string}>};
async function scope(r:Request,args:RouteArgs) {
  const ids=new URL(r.url).searchParams.getAll("organizationId");
  return {ctx:await context(r,ids.length===1?ids[0]:null),id:validId((await args.params).id)};
}
export async function GET(r:Request,args:RouteArgs) {
  try {const {ctx,id}=await scope(r,args);return reply(await lossScenarios(ctx,id));} catch(e){return fail(e);}
}
export async function POST(r:Request,args:RouteArgs) {
  try {const {ctx,id}=await scope(r,args);return reply(await saveLossScenario(ctx,id,await readBody(r,12000)),201);} catch(e){return fail(e);}
}
