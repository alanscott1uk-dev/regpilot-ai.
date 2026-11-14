import {readPublicHorizon} from '../../../lib/server/horizon-service';
import {reportState} from '../../../lib/horizon/model';
import {reply} from '../../../lib/server/intelligence-http';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(){try{const report=await readPublicHorizon();return reply({report,state:reportState(report)});}catch{return reply({error:'The live horizon feed is unavailable. No current coverage is inferred.'},503);}}
