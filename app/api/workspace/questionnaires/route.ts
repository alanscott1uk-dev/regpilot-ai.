import {context,reply,fail,readBody,validId} from "../../../../lib/server/operations-http";
import {questionnaireWorkspace,createQuestionnaire} from "../../../../lib/server/customer-assurance-service";
import {IntelligenceError} from "../../../../lib/server/intelligence-service";
export const runtime="nodejs";export const dynamic="force-dynamic";
function query(request:Request){const params=new URL(request.url).searchParams;for(const key of ["organizationId","requestKey"])if(params.getAll(key).length>1)throw new IntelligenceError("Duplicate request parameter");return params;}
export async function GET(r:Request){try{const values=query(r);return reply(await questionnaireWorkspace(await context(r,values.get("organizationId")),values.has("requestKey")?validId(values.get("requestKey")):undefined));}catch(e){return fail(e);}}
export async function POST(r:Request){try{const values=query(r),c=await context(r,values.get("organizationId"),true);return reply(await createQuestionnaire(c,await readBody(r,1600000)),201);}catch(e){return fail(e);}}
