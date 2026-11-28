import {context,reply,fail,validId} from '../../../../../lib/server/operations-http';
import {evaluationReceipt} from '../../../../../lib/server/evaluation-service';
export const runtime='nodejs',dynamic='force-dynamic';
export async function GET(request:Request){try{const p=new URL(request.url).searchParams;return reply(await evaluationReceipt(await context(request,p.get('organizationId')),validId(p.get('requestKey'))));}catch(e){return fail(e);}}
