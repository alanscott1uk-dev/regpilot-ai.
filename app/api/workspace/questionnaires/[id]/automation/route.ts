import {context,reply,fail,readBody,validId} from '../../../../../../lib/server/operations-http';
import {automateQuestionnaire,questionnaireAutomation} from '../../../../../../lib/server/questionnaire-automation-service';
import {IntelligenceError} from '../../../../../../lib/server/intelligence-service';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
type Params={params:Promise<{id:string}>};
function query(request:Request){const params=new URL(request.url).searchParams;for(const key of ['organizationId','requestKey'])if(params.getAll(key).length>1)throw new IntelligenceError('Duplicate request parameter');return params;}
export async function GET(request:Request,params:Params){try{const values=query(request),c=await context(request,values.get('organizationId'));return reply(await questionnaireAutomation(c,validId((await params.params).id),values.has('requestKey')?validId(values.get('requestKey')):undefined));}catch(error){return fail(error);}}
export async function POST(request:Request,params:Params){try{const values=query(request),c=await context(request,values.get('organizationId'),true);return reply(await automateQuestionnaire(c,validId((await params.params).id),await readBody(request,20000)));}catch(error){return fail(error);}}
