import {verifyWorkerIdentity} from '../../../../lib/server/worker-identity';
import {runPrivateWorker} from '../../../../lib/server/worker-runtime';
import {reply} from '../../../../lib/server/intelligence-http';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=120;
export async function POST(request:Request){
 let identity;try{identity=await verifyWorkerIdentity(request.headers.get('authorization'));}catch{return reply({error:'Unauthorised worker'},401);}
 try{const result=await runPrivateWorker(identity.invocationKey);return reply(result.body,result.status);}catch{return reply({error:'Worker unavailable'},503);}
}
