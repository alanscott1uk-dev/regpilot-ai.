import {z} from 'zod';
import {atStep} from './collection-step';
import {CollectionError} from './collection-error';
import {providerReader} from './bounded-http';
import type {Observation} from './observation';
import type {HourlyTemperature} from '../temperature-window';

const hour=3600000;
const stats=z.object({count:z.number().int().positive(),min:z.number().finite(),max:z.number().finite()}).refine(v=>v.min<=v.max);
const reply=z.object({result:z.literal('success'),channel:z.object({channel_id:z.union([z.string(),z.number()]),serial:z.string().optional()}),
 feeds:z.array(z.object({created_at:z.iso.datetime({offset:true}),field1:z.unknown().optional()})).max(25),is_truncated:z.boolean().optional()});

export async function collectUbiBotHistory(point:Observation,scope:string,serial:string,reference:string,token:string,fetcher:typeof fetch):Promise<Observation>{
 const through=Math.floor(Date.parse(point.capturedAt)/hour)*hour-2*hour;
 const from=through-24*hour;
 const format=(ms:number)=>new Date(ms).toISOString().slice(0,19).replace('T',' ');
 const sourceUrl='https://webapi.ubibot.com/channels/'+scope+'/summary.json';
 const params=new URLSearchParams({api_key:token,timezone:'UTC',start:format(from),end:format(through-1000),results:'25'});
 const result=await atStep('logger-history',()=>providerReader(fetcher,{},8000)(sourceUrl+'?'+params));
 const parsed=reply.safeParse(result!.body);
 if(!parsed.success)throw new CollectionError('INVALID_RESPONSE',undefined,'logger-history');
 const {channel,feeds,is_truncated}=parsed.data;
 if(String(channel.channel_id)!==scope||(channel.serial!==undefined&&channel.serial!==serial))throw new CollectionError('TARGET_MISMATCH',undefined,'logger-history');
 const buckets=new Map<number,HourlyTemperature['hours'][number]>();
 let complete=is_truncated!==true;
 for(const row of feeds){
  const at=Date.parse(row.created_at);
  if(at<from||at>=through||at%hour!==0)throw new CollectionError('INVALID_RESPONSE',undefined,'logger-history');
  const values=stats.safeParse(row.field1);
  if(!values.success){complete=false;continue;}
  if(buckets.has(at))throw new CollectionError('INVALID_RESPONSE',undefined,'logger-history');
  buckets.set(at,{start:new Date(at).toISOString(),minimum:values.data.min,maximum:values.data.max,samples:values.data.count});
 }
 const hours=[...buckets.values()].sort((a,b)=>a.start.localeCompare(b.start));
 complete=complete&&hours.length===24;
 const [,,calibrated,due,low,high]=reference.split('/');
 const allCalibrated=hours.every(h=>h.start.slice(0,10)>=calibrated&&h.start.slice(0,10)<due);
 const outside=hours.filter(h=>h.minimum<Number(low)||h.maximum>Number(high));
 const window={from:new Date(from).toISOString(),through:new Date(through).toISOString(),complete,hours,...(channel.serial===serial?{instrumentSerial:serial}:{})};
 const range=hours.length?' · '+Math.min(...hours.map(h=>h.minimum))+' to '+Math.max(...hours.map(h=>h.maximum))+' °C':'';
 return {...point,engine:'ubibot-temperature-history-1',hourlyTemperature:window,
  checks:[...point.checks,
   {id:'logger-hourly-range',label:'Reported hourly extremes within site limits',status:outside.length?'FAIL':complete?'PASS':'UNKNOWN',observed:outside.length+' recorded hours outside '+low+' to '+high+' °C'+range,nextStep:'Investigate the affected hours against the original instrument trace and stock movement.',sourceUrl},
   {id:'logger-hourly-coverage',label:'All 24 expected hourly summaries present within the certificate dates',status:complete&&allCalibrated?'PASS':'UNKNOWN',observed:hours.length+' of 24 hours · '+window.from+' to '+window.through,nextStep:'Recover missing readings and verify calibration across the reporting period.',sourceUrl}],
  limitations:['Hourly minima and maxima refer to reported field1 samples. The latest two hours and the current hour are excluded to allow for publisher processing. The exact time and duration of an excursion require the original instrument trace.']};
}
