import {context,reply,fail,readBody,validId} from "../../../../lib/server/operations-http";
import {answerWorkspace,createAssuranceAnswer} from "../../../../lib/server/customer-assurance-service";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(r:Request){try{const params=new URL(r.url).searchParams;if(params.getAll("organizationId").length>1||params.getAll("requestKey").length>1)return reply({error:"Duplicate request parameter"},400);return reply(await answerWorkspace(await context(r,params.get("organizationId")),params.has("requestKey")?validId(params.get("requestKey")):undefined));}catch(e){return fail(e);}}
export async function POST(r:Request){try{const c=await context(r,new URL(r.url).searchParams.get("organizationId"),false);return reply(await createAssuranceAnswer(c,await readBody(r,220000)),201);}catch(e){return fail(e);}}
