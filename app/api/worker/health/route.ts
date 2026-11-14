import {workerHealth} from '../../../../lib/server/worker-runtime';
import {reply} from '../../../../lib/server/intelligence-http';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(){try{const health=await workerHealth();return reply(health,health.ok?200:503);}catch{return reply({state:'unavailable',ok:false},503);}}
