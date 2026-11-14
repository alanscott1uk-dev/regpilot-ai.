import {readPublicHorizon} from '../../../../lib/server/horizon-service';
import {reportState} from '../../../../lib/horizon/model';
import {reply} from '../../../../lib/server/intelligence-http';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(){
 try{const report=await readPublicHorizon(),state=reportState(report);
  return reply({state,generatedAt:report.generatedAt,ageSeconds:Math.max(0,Math.floor((Date.now()-Date.parse(report.generatedAt))/1000)),cadenceMinutes:report.pipeline?.cadenceMinutes||360,publications:report.items.length,publishers:report.feeds.map(({id,state,retrieved,total})=>({id,state,retrieved,total})),recentPublishedRuns:report.pipeline?.history||[],limitation:'Published-run history and metadata freshness only; not an uptime or legal coverage guarantee.'},state==='stale'||state==='degraded'?503:200);
 }catch{return reply({state:'unavailable',error:'Public collection health unavailable'},503);}
}
