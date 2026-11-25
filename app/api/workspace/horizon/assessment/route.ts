import {context,fail,readBody,reply,validId} from '../../../../../lib/server/operations-http';
import {applicabilityAssessment,changeApplicabilityAssessment} from '../../../../../lib/server/horizon-applicability-assessment';
export const runtime='nodejs',dynamic='force-dynamic',maxDuration=120;
export async function GET(r:Request){try{const p=new URL(r.url).searchParams,c=await context(r,p.get('organizationId'),true);return reply(await applicabilityAssessment(c,p.has('id')?validId(p.get('id')):undefined));}catch(e){return fail(e);}}
export async function POST(r:Request){try{const c=await context(r,new URL(r.url).searchParams.get('organizationId'),true);return reply(await changeApplicabilityAssessment(c,await readBody(r,52000)));}catch(e){return fail(e);}}
