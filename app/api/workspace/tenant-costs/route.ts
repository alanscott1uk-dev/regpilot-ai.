import {context,fail,readBody,reply} from '../../../../lib/server/operations-http';
import {tenantCosts,changeCosts} from '../../../../lib/server/tenant-costs';
export const dynamic='force-dynamic';
export async function GET(r:Request){try{const p=new URL(r.url).searchParams;return reply(await tenantCosts(await context(r,p.get('organizationId'),true),p.get('month')||''));}catch(e){return fail(e);}}
export async function POST(r:Request){try{return reply(await changeCosts(await context(r,new URL(r.url).searchParams.get('organizationId'),true),await readBody(r,6000)));}catch(e){return fail(e);}}
