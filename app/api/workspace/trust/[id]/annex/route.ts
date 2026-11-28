import {context,fail,readBody,reply,validId} from '../../../../../../lib/server/operations-http';
import {attachBuyerAnnex,buyerAnnexOptions} from '../../../../../../lib/server/buyer-annex';
export const dynamic='force-dynamic';
type P={params:Promise<{id:string}>};
export async function GET(r:Request,{params}:P){try{const p=new URL(r.url).searchParams;return reply(await buyerAnnexOptions(await context(r,p.get('organizationId'),true),validId((await params).id),validId(p.get('grantId'))));}catch(e){return fail(e);}}
export async function POST(r:Request,{params}:P){try{return reply(await attachBuyerAnnex(await context(r,new URL(r.url).searchParams.get('organizationId'),true),validId((await params).id),await readBody(r,1000)));}catch(e){return fail(e);}}
