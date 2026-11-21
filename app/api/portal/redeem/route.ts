import {redeemPortalHandoff} from '../../../../lib/server/portal-handoff';
import {workspaceConfigured} from '../../../../lib/server/ai-auth';
import {reply,readBody,fail} from '../../../../lib/server/operations-http';
export const dynamic='force-dynamic';
export async function POST(req:Request){try{if(!workspaceConfigured())return reply({error:'Private workspace awaits activation'},503);return reply(await redeemPortalHandoff(await readBody(req,105000)));}catch(e){return fail(e);}}
