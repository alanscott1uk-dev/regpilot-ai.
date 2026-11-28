import {context,validId,readBody,reply,fail} from '../../../../../../lib/server/operations-http';
import {programmeReferenceStatement,decideProgrammeReference} from '../../../../../../lib/server/programme-reference-review';
export const dynamic='force-dynamic';
type Params={params:Promise<{id:string}>};
export async function GET(r:Request,{params}:Params){try{const ctx=await context(r,new URL(r.url).searchParams.get('organizationId'),true);return reply(await programmeReferenceStatement(ctx,validId((await params).id)));}catch(e){return fail(e);}}
export async function POST(r:Request,{params}:Params){try{const ctx=await context(r,new URL(r.url).searchParams.get('organizationId'),true);return reply(await decideProgrammeReference(ctx,validId((await params).id),await readBody(r,6000)));}catch(e){return fail(e);}}
