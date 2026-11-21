import {context,fail,readBody,reply} from '../../../../../lib/server/operations-http';
import {groupRiskReport} from '../../../../../lib/server/group-risk-report';
export const dynamic='force-dynamic';
export async function POST(req:Request){try{return reply(await groupRiskReport(await context(req,new URL(req.url).searchParams.get('organizationId'),true),await readBody(req,6000)));}catch(e){return fail(e);}}
