import {context,readBody,reply,fail} from '../../../../lib/server/operations-http';
import {territorialReport,changeTerritorialCase} from '../../../../lib/server/territorial-benchmark';
export const dynamic='force-dynamic';
export async function GET(r:Request){try{return reply(await territorialReport(await context(r,new URL(r.url).searchParams.get('organizationId'))));}catch(e){return fail(e);}}
export async function POST(r:Request){try{return reply(await changeTerritorialCase(await context(r,new URL(r.url).searchParams.get('organizationId')),await readBody(r,4000)));}catch(e){return fail(e);}}
