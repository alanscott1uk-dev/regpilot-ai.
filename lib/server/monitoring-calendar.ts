import {completeLoggerWindow} from '../temperature-window';
import {z} from 'zod';
import type {Prisma} from '@prisma/client';
import {completedManagedSync} from '../connectors/monitoring-product';
import {isTemperatureLogger} from '../connectors/record-catalogue';
import type {Observation} from '../connectors/observation';
import {verifiedObservation} from './connector-observation';

const dayMs=86400000,limit=1000;
const receipt=z.object({runId:z.uuid(),resultHash:z.string(),configVersion:z.number().int().positive(),intervalHours:z.union([z.literal(1),z.literal(24),z.literal(168)]).optional()});
type CountedReceipt={id:string;at:string;sha256:string;followUp:boolean};
type Day={date:string;reads:CountedReceipt[];unverified:number};

function sourceTime(provider:string,observation:Observation,intervalHours?:number):number|null{
 if(provider==='NANGO_SYNC')return completedManagedSync(observation,intervalHours);
 if(isTemperatureLogger(provider)){
  const checks=observation.checks;
  const reading=checks.find(check=>check.id==='logger-fresh'&&check.status==='PASS');
  if(!reading||!completeLoggerWindow(observation)||!checks.some(check=>check.id==='logger-calibration'&&check.status==='PASS')||
     !checks.some(check=>check.id==='logger-temperature'&&check.status!=='UNKNOWN'))return null;
  const at=Date.parse(reading.observed);
  return Number.isFinite(at)?at:null;
 }
 return Date.parse(observation.capturedAt);
}

/** Count a collection on its UTC date. An initial read, a retry and a manual check
 * cannot fill an empty day. Keep earlier credential versions within the same scope. */
export async function monitoringCalendar(tx:Prisma.TransactionClient,org:string,id:string,provider:string,scopeHash:string,now:number){
 const end=new Date(now);end.setUTCHours(0,0,0,0);
 const start=new Date(end.getTime()-30*dayMs);
 const days:Day[]=Array.from({length:30},(_,index)=>({
  date:new Date(start.getTime()+index*dayMs).toISOString().slice(0,10),reads:[],unverified:0
 }));
 const events=await tx.auditEvent.findMany({where:{
  organizationId:org,entityType:'EvidenceConnector',entityId:id,action:'connector.evidence_collected',
  createdAt:{gte:start,lt:end},AND:[
   {details:{path:['scopeHash'],equals:scopeHash}},{details:{path:['collectionMode'],equals:'SCHEDULED'}}
  ]},orderBy:[{createdAt:'desc'},{id:'desc'}],take:limit+1,select:{createdAt:true,details:true}});
 const limited=events.length>limit;
 const candidates=events.slice(0,limit).reverse().map(event=>({at:event.createdAt,facts:receipt.safeParse(event.details).data}));
 const ids=candidates.flatMap(event=>event.facts?[event.facts.runId]:[]);
 const rows=ids.length?await tx.connectorRun.findMany({where:{id:{in:ids},organizationId:org,connectorId:id,capturedAt:{gte:start,lt:end}},
  select:{id:true,capturedAt:true,configVersion:true,result:true,resultHash:true,signalHash:true,outcome:true}}):[];
 const byId=new Map(rows.map(run=>[run.id,run])),seen=new Set<string>();
 let lastSourceTime=-Infinity;
 for(const {at,facts} of candidates){
  const day=days[Math.floor((at.getTime()-start.getTime())/dayMs)];
  if(facts&&seen.has(facts.runId))continue;
  const run=facts&&byId.get(facts.runId);
  const observation=run&&run.resultHash===facts.resultHash&&run.configVersion===facts.configVersion&&
   run.capturedAt.toISOString().slice(0,10)===day.date?verifiedObservation(run):null;
  const stamp=observation&&sourceTime(provider,observation,facts?.intervalHours);
  if(!run||!observation||!observation.checks.length||observation.checks.some(c=>c.status==='UNKNOWN')||stamp===null||
      (provider==='NANGO_SYNC'||isTemperatureLogger(provider))&&stamp<=lastSourceTime){
   day.unverified++;continue;
  }
  seen.add(run.id);lastSourceTime=stamp;
  day.reads.push({id:run.id,at:run.capturedAt.toISOString(),sha256:run.resultHash,followUp:observation.checks.some(c=>c.status==='FAIL')});
 }
 const withReads=(period:Day[])=>period.filter(day=>day.reads.length>0).length;
 return {from:days[0].date,through:days[29].date,observedDays7:withReads(days.slice(-7)),observedDays30:withReads(days),limited,days};
}
