import {executeScheduledTick} from '../cron-tick.mjs';
import {pruneWebhookReceipts} from './connector-webhooks';
import {prunePublicSourceFetches} from './shared-source-fetch';
type Tick=Awaited<ReturnType<typeof executeScheduledTick>>;
export async function runWorkerMaintenance(){
 const [webhookReceipts,publicSources]=await Promise.all([pruneWebhookReceipts(),prunePublicSourceFetches()]);
 return {webhookReceipts,publicSources};
}
/** Maintenance failure must be visible without cancelling independent collection. */
export async function executeWithMaintenance(execute:()=>Promise<Tick>,maintenance?:()=>Promise<{webhookReceipts:number;publicSources:number}>){
 const [work,cleanup]=await Promise.allSettled([Promise.resolve().then(execute),maintenance?Promise.resolve().then(maintenance):Promise.resolve(null)]);
 const failed={state:'failed' as const,processed:0,attention:1};
 const result=work.status==='fulfilled'?work.value:{ok:false,modules:{sources:failed,connectors:failed,controlReviews:failed}};
 return {...result,ok:result.ok&&cleanup.status==='fulfilled',maintenance:cleanup.status==='fulfilled'?(cleanup.value?{state:'completed',...cleanup.value}:{state:'disabled'}):{state:'failed'}};
}
