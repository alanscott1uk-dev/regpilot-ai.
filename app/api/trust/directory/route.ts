import {reply,fail} from '../../../../lib/server/operations-http';
import {workspaceConfigured} from '../../../../lib/server/ai-auth';
import {publicSummaries} from '../../../../lib/server/trust-publication';
export const dynamic='force-dynamic';
export async function GET(req:Request){try{const p=new URL(req.url).searchParams;return reply({summaries:workspaceConfigured()?await publicSummaries({id:p.get('id')||undefined,q:p.get('q')||undefined}):[]});}catch(e){return fail(e);}}
