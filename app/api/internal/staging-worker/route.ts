import {runDatabaseWorker,workerEnabled} from '../../../../lib/server/worker-runtime';
import {db} from '../../../../lib/server/db';
import {reply} from '../../../../lib/server/intelligence-http';

export const runtime='nodejs',dynamic='force-dynamic',maxDuration=120;
export async function POST(req:Request){
 if(process.env.VERCEL_ENV!=='preview'||process.env.VERCEL_GIT_COMMIT_REF!=='feature/traceability-benchmark-batch-20261106'||!workerEnabled())return reply({state:'disabled'},404);
 const token=/^Bearer ([0-9]{1,12})\.([a-f0-9]{64})$/.exec(req.headers.get('authorization')??'');
 if(!token)return reply({state:'unauthorised'},401);
 try{
  const bucket=Number(token[1]);
  const [row]=await db.$queryRaw<{valid:boolean}[]>`SELECT regpilot_verification.verify_worker_clock(${bucket}::bigint,${token[2]}::text) AS valid`;
  if(!row?.valid)return reply({state:'unauthorised'},401);
  const result=await runDatabaseWorker(bucket);
  return reply({state:result.body.state},result.status);
 }catch{return reply({state:'unavailable'},503);}
}
