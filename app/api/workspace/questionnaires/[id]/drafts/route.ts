import {context,reply,fail,readBody,validId} from "../../../../../../lib/server/operations-http";
import {prepareQuestionnaireDraft,questionnaireDrafts} from "../../../../../../lib/server/questionnaire-draft-service";
export const runtime="nodejs";export const dynamic="force-dynamic";export const maxDuration=120;
type Params={params:Promise<{id:string}>};
export async function GET(r:Request,p:Params){try{const query=new URL(r.url).searchParams,c=await context(r,query.get("organizationId")),id=validId((await p.params).id);return reply(await questionnaireDrafts(c,id,{...(query.has("runId")?{runId:validId(query.get("runId"))}:{}),...(query.has("requestKey")?{requestKey:validId(query.get("requestKey"))}:{})}));}catch(e){return fail(e);}}
export async function POST(r:Request,p:Params){try{const c=await context(r,new URL(r.url).searchParams.get("organizationId"));return reply(await prepareQuestionnaireDraft(c,validId((await p.params).id),await readBody(r,8000)));}catch(e){return fail(e);}}
