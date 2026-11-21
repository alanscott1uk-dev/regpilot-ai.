import {context,reply,fail,readBody,validId} from '../../../../../lib/server/operations-http';
import {trustPublicationAdmin,manageTrustPublication} from '../../../../../lib/server/trust-publication';
export const dynamic='force-dynamic';
type Params={params:Promise<{id:string}>};
export async function GET(req:Request,{params}:Params){try{return reply(await trustPublicationAdmin(await context(req,new URL(req.url).searchParams.get('organizationId'),true),validId((await params).id)));}catch(e){return fail(e);}}
export async function POST(req:Request,{params}:Params){try{return reply(await manageTrustPublication(await context(req,new URL(req.url).searchParams.get('organizationId'),true),validId((await params).id),await readBody(req,2000)));}catch(e){return fail(e);}}
