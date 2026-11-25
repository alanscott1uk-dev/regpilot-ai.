import type {ReportedHour} from '../temperature-window';
import type {Prisma} from '@prisma/client';
import {temperatureHistory,type TemperatureHistory} from '../excursion-history';
import {hashValue} from '../regulatory/intelligence';
import {verifiedObservation} from './connector-observation';
import {IntelligenceError} from './intelligence-service';

const day=86400000;
const fields={id:true,result:true,resultHash:true,signalHash:true,outcome:true,configVersion:true} as const;
type Run=Prisma.ConnectorRunGetPayload<{select:typeof fields}>;
type Anchor={runId:string;connectorId:string;resultHash:string;sampleAt:string;calibration:string;reportedHour?:ReportedHour};
const unavailable=()=>new IntelligenceError('A retained temperature reading could not be verified against its source receipt.',409);

function point(run:Run,anchor:Anchor,from:string,through:string){
 const observation=verifiedObservation(run);
 if(!observation)return null;
 const checks=observation.checks;
 const at=checks.find(c=>c.id==='logger-fresh'&&c.status==='PASS')?.observed;
 const temperature=checks.find(c=>c.id==='logger-temperature'&&c.status!=='UNKNOWN');
 const calibrated=checks.some(c=>c.id==='logger-calibration'&&c.status==='PASS'&&c.observed===anchor.calibration);
 if(!at||!temperature||!calibrated||!Number.isFinite(Date.parse(at))||Date.parse(at)<Date.parse(from)||Date.parse(at)>Date.parse(through))return null;
 const value=/^(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?) °C · limits /i.exec(temperature.observed);
 if(!value||!Number.isFinite(Number(value[1])))return null;
 return {runId:run.id,resultHash:run.resultHash,at:new Date(at).toISOString(),celsius:Number(value[1]),status:temperature.status as 'PASS'|'FAIL'};
}

export async function captureTemperatureHistory(tx:Prisma.TransactionClient,org:string,anchor:Anchor,decisionTime:string){
 const where={organizationId:org,connectorId:anchor.connectorId};
 const origin=await tx.connectorRun.findFirst({where:{...where,id:anchor.runId},select:fields});
 if(!origin||origin.resultHash!==anchor.resultHash)throw unavailable();
 const at=Date.parse(anchor.sampleAt),from=new Date(at-day),through=new Date(Math.min(at+day,Date.parse(decisionTime)));
 // A qualifying logger sample may be collected up to one day after the instrument timestamp.
 const rows=await tx.connectorRun.findMany({where:{...where,configVersion:origin.configVersion,id:{not:origin.id},
  capturedAt:{gte:from,lte:new Date(through.getTime()+day)}},orderBy:[{capturedAt:'desc'},{id:'asc'}],take:101,select:fields});
 const start=from.toISOString(),end=through.toISOString(),selected=point(origin,anchor,start,end);
 const window=verifiedObservation(origin)?.hourlyTemperature;
 if(anchor.reportedHour){
  const matched=window?.hours.find(h=>h.start===anchor.sampleAt);
  if(!matched||hashValue(matched)!==hashValue(anchor.reportedHour))throw unavailable();
 }else if(!selected||selected.status!=='FAIL')throw unavailable();
 const points=[...(selected?[selected]:[]),...rows.slice(0,100).flatMap(run=>point(run,anchor,start,end)??[])];
 points.sort((a,b)=>a.at.localeCompare(b.at)||a.runId.localeCompare(b.runId));
 return temperatureHistory.parse({from:start,through:end,version:origin.configVersion,limited:rows.length>100,hourlyTemperature:window,points});
}

export async function verifyTemperatureHistory(tx:Prisma.TransactionClient,org:string,anchor:Anchor,history:TemperatureHistory){
 const ids=[...new Set([anchor.runId,...history.points.map(p=>p.runId)])];
 const rows=await tx.connectorRun.findMany({where:{organizationId:org,connectorId:anchor.connectorId,configVersion:history.version,id:{in:ids}},select:fields});
 const byId=new Map(rows.map(run=>[run.id,run]));
 if(rows.length!==ids.length||byId.get(anchor.runId)?.resultHash!==anchor.resultHash)throw unavailable();
 if(history.hourlyTemperature){
  const original=verifiedObservation(byId.get(anchor.runId))?.hourlyTemperature;
  if(!original||hashValue(original)!==hashValue(history.hourlyTemperature))throw unavailable();
 }
 for(const stored of history.points){
  const current=point(byId.get(stored.runId)!,anchor,history.from,history.through);
  if(!current||hashValue(current)!==hashValue(stored))throw unavailable();
 }
}
