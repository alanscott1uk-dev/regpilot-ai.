import {context,readBody,reply,fail} from '../../../../lib/server/operations-http';
import {helpMaintenance,changeHelp} from '../../../../lib/server/help-support';
export const dynamic='force-dynamic';
export async function GET(r:Request){try{return reply(await helpMaintenance(await context(r,new URL(r.url).searchParams.get('organizationId'))));}catch(e){return fail(e);}}
export async function POST(r:Request){try{return reply(await changeHelp(await context(r,new URL(r.url).searchParams.get('organizationId')),await readBody(r,900)));}catch(e){return fail(e);}}
