import {context,reply,fail,readBody,validId} from "../../../../../lib/server/operations-http";
import {searchKnowledge,knowledgeSearch} from "../../../../../lib/server/company-knowledge-service";
export const runtime="nodejs",dynamic="force-dynamic",maxDuration=120;
export async function POST(request:Request){try{const params=new URL(request.url).searchParams,c=await context(request,params.get("organizationId"));return reply(await searchKnowledge(c,await readBody(request,8000)));}catch(error){return fail(error);}}
export async function GET(request:Request){try{const params=new URL(request.url).searchParams,c=await context(request,params.get("organizationId"));return reply(await knowledgeSearch(c,{...(params.has("runId")?{runId:validId(params.get("runId"))}:{}),...(params.has("requestKey")?{requestKey:validId(params.get("requestKey"))}:{})}));}catch(error){return fail(error);}}
