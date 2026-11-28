// Only a configured Vercel preview exercises the real development broker.
import {pdProjectHealth} from '../lib/connectors/pipedream-client';
import {runStagingProductProbe,stagingProbeTarget} from '../lib/server/staging-product-probe';
import {CollectionError} from '../lib/connectors/collection-error';

async function main(){
 if(process.env.VERCEL_ENV!=='preview'||!process.env.REGPILOT_PIPEDREAM_PROJECT_ID)return;
 if((process.env.REGPILOT_PIPEDREAM_ENVIRONMENT??'development')!=='development')return;
 const receipt=await pdProjectHealth();
 console.log('Verified Pipedream project and account inventory',JSON.stringify(receipt));
 const target=stagingProbeTarget();
 if(target){
  const result=await runStagingProductProbe(target);
  console.log('RegPilot live product probe',JSON.stringify(result));
 }
}
main().catch(error=>{
 console.error('Pipedream staging verification failed',error instanceof CollectionError?[error.step,error.code].filter(Boolean).join(' '):'NETWORK_ERROR');
 process.exitCode=1;
});
