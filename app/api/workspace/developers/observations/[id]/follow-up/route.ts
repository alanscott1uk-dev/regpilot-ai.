import {context,reply,readBody,fail,validId} from '../../../../../../../lib/server/operations-http';
import {bindPartnerModel,partnerFollowUp} from '../../../../../../../lib/server/partner-follow-up';
export const dynamic='force-dynamic';
type P={params:Promise<{id:string}>};
export async function GET(r:Request,{params}:P){try{return reply(await partnerFollowUp(await context(r,new URL(r.url).searchParams.get('organizationId'),true),validId((await params).id)));}catch(e){return fail(e);}}
export async function POST(r:Request,{params}:P){try{return reply(await bindPartnerModel(await context(r,new URL(r.url).searchParams.get('organizationId'),true),validId((await params).id),await readBody(r,800)));}catch(e){return fail(e);}}
