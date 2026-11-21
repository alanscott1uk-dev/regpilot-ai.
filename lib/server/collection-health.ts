import {db} from './db';
import type {executeScheduledTick} from '../cron-tick.mjs';
type Tick=Awaited<ReturnType<typeof executeScheduledTick>>;
/** A paused failed schedule still needs repair. An empty worker sweep cannot
 * clear an incident; only the persisted schedule's recovery can clear it. */
export async function collectionAttention(){
 const [sources,connectors]=await Promise.all([
  db.watchSchedule.count({where:{failureCode:{not:null,notIn:['SOURCE_FETCH_BUSY','SOURCE_FETCH_SUPERSEDED','ANALYSIS_DEFERRED']}}}),
  db.evidenceConnector.count({where:{failureCode:{not:null}}})
 ]);
 return {sources,connectors};
}
export async function finalizeCollectionTick<T extends Tick>(result:T,read=collectionAttention):Promise<T>{
 try{
  const counts=await read();
  const modules={...result.modules};
  for(const kind of ['sources','connectors'] as const){
   const part=modules[kind];
   if(part.state==='disabled')continue;
   if(counts[kind]>0)modules[kind]={...part,state:part.state==='failed'?'failed':'attention',attention:Math.max(part.attention,counts[kind])};
  }
  return {...result,ok:result.ok&&!Object.values(modules).some(part=>part?.state==='attention'||part?.state==='failed'),modules};
 }catch{
  return {...result,ok:false,modules:{...result.modules,sources:{...result.modules.sources,state:'failed',attention:Math.max(1,result.modules.sources.attention)}}};
 }
}
