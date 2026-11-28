import {context,readBody,reply,fail} from '../../../../lib/server/operations-http';
import {publicationSamples,recordPublicationSample} from '../../../../lib/server/publication-sample';
export const dynamic='force-dynamic',maxDuration=120;
export async function GET(request:Request){try{return reply(await publicationSamples(await context(request,new URL(request.url).searchParams.get('organizationId'))));}catch(e){return fail(e);}}
export async function POST(request:Request){try{return reply(await recordPublicationSample(await context(request,new URL(request.url).searchParams.get('organizationId')),await readBody(request,30000)));}catch(e){return fail(e);}}
