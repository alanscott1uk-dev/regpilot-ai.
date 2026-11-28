import {context,readBody,reply,fail} from '../../../../lib/server/operations-http';
import {recordTrial,trialWorkspace} from '../../../../lib/server/capability-trial-service';
export const dynamic='force-dynamic';
export async function GET(r:Request){try{
 const params=new URL(r.url).searchParams;
 return reply(await trialWorkspace(await context(r,params.get('organizationId')),{trialId:params.get('trialId')??undefined,release:params.get('release')??undefined,before:params.get('before')??undefined}));
}catch(e){return fail(e);}}
export async function POST(r:Request){try{return reply(await recordTrial(await context(r,new URL(r.url).searchParams.get('organizationId')),await readBody(r,16000)));}catch(e){return fail(e);}}
