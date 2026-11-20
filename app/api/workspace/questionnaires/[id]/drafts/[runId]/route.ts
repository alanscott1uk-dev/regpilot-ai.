import {context,reply,fail,readBody,validId} from "../../../../../../../lib/server/operations-http";
import {saveQuestionnaireDraft} from "../../../../../../../lib/server/questionnaire-draft-service";
export const runtime="nodejs";export const dynamic="force-dynamic";export const maxDuration=60;
type Params={params:Promise<{id:string;runId:string}>};
export async function PATCH(r:Request,p:Params){try{const c=await context(r,new URL(r.url).searchParams.get("organizationId")),params=await p.params;return reply(await saveQuestionnaireDraft(c,validId(params.id),validId(params.runId),await readBody(r,12000)));}catch(e){return fail(e);}}
