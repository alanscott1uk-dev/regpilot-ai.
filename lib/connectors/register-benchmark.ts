import {collectPublicRegister,referenceRegisters,type PublicRegister} from './pharma-registers';
import {observationSchema,type Observation} from './observation';

export const integrationBenchmark=500;
const day=86400000;
export type PublicReceipt={
 batch:string;started_at:Date;provider:PublicRegister;part:string;url:string;finished_at:Date|null;
 http_status:number|null;metadata:unknown;fingerprint:string|null;intact:boolean|null;
};
type Evaluated={batch:string;startedAt:string;state:'Collected'|'Incomplete'|'Waiting'|'Unavailable';reason:string;observation:Observation|null};
export async function evaluateRegisterBatch(target:typeof referenceRegisters[number],rows:PublicReceipt[]):Promise<Evaluated>{
 const first=rows[0],base={batch:first.batch,startedAt:first.started_at.toISOString(),observation:null};
 const pending=rows.some(r=>!r.finished_at);
 if(pending)return {...base,state:'Waiting',reason:'Awaiting the publisher response.'};
 const failed=rows.find(r=>r.http_status!==200||!r.intact);
 if(failed)return {...base,state:'Unavailable',reason:failed.http_status!==200?'Publisher response '+(failed.http_status??'unavailable')+'.':'The source receipt could not be verified.'};
 try{
  const requests=new Set<string>();
  const observation=observationSchema.parse(await collectPublicRegister(target.provider,target.target,async(raw)=>{
   const url=String(raw),matches=rows.filter(r=>r.url===url);
   if(matches.length!==1||requests.has(url))throw Error('Source request mismatch');
   requests.add(url);return Response.json(matches[0].metadata);
  },base.startedAt));
  if(requests.size!==rows.length)throw Error('Unexpected source response');
  return {...base,observation,state:observation.checks.some(c=>c.status==='UNKNOWN')?'Incomplete':'Collected',reason:''};
 }catch{return {...base,state:'Unavailable',reason:'Stored source records could not be matched to this control.'};}
}
export async function registerBenchmark(rows:PublicReceipt[],now=Date.now()){
 const products=await Promise.all(referenceRegisters.map(async target=>{
  const groups=new Map<string,PublicReceipt[]>();
  for(const row of rows.filter(r=>r.provider===target.provider)){
   const group=groups.get(row.batch)??[];group.push(row);groups.set(row.batch,group);
  }
  const ranked=[...groups.values()].sort((a,b)=>b[0].started_at.getTime()-a[0].started_at.getTime());
  const receipts=await Promise.all(ranked.map(r=>evaluateRegisterBatch(target,r)));
  const latest=receipts[0]??null,at=latest?Date.parse(latest.startedAt):0;
  const fresh=latest?.state==='Collected'&&now>=at&&now-at<=day+30*60000;
  const previous=latest?.state==='Collected'?receipts.find(r=>r.state==='Collected'&&at-Date.parse(r.startedAt)>=day&&at-Date.parse(r.startedAt)<=day+30*60000)??null:null;
  return {...target,latest,previous,qualifies:!!fresh&&!!previous,stale:!!latest&&now-at>day+30*60000};
 }));
 return {target:integrationBenchmark,qualified:products.filter(p=>p.qualifies).length,products};
}
