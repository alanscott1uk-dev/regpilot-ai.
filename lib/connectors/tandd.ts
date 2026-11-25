import {z} from 'zod';
import {readBoundedJson} from './bounded-http';
import {CollectionError} from './collection-error';
import {temperatureObservation} from './temperature-logger';

export const tanddCredentials=z.object({
 loginId:z.string().length(8).regex(/^[A-Za-z0-9]+$/),
 password:z.string().min(4).max(16).regex(/^[^\u0000-\u001f\u007f]+$/),
 apiKey:z.string().length(45).regex(/^[A-Za-z0-9]+$/)
}).strict();
const endpoint='https://api.webstorage-service.com/v1/devices/current';
const current=z.object({devices:z.array(z.object({
 serial:z.string(),unixtime:z.string(),channel:z.array(z.object({num:z.string(),unit:z.string(),value:z.string()})).max(64)
})).max(1)});

export async function collectTandD(target:{scope:string;record:string;reference:string},secret:string,fetcher:typeof fetch,certificateHash?:string){
 let credentials:z.infer<typeof tanddCredentials>;
 try{credentials=tanddCredentials.parse(JSON.parse(secret));}
 catch{throw new CollectionError('INVALID_TARGET',undefined,'tandd-reading');}
 const request={'api-key':credentials.apiKey,'login-id':credentials.loginId,'login-pass':credentials.password,'remote-serial':[target.record]};
 let response:Response;
 try{
  response=await fetcher(endpoint,{method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000),
   headers:{'Content-Type':'application/json','Accept':'application/json','X-HTTP-Method-Override':'GET'},body:JSON.stringify(request)});
 }catch{throw new CollectionError('PROVIDER_UNAVAILABLE',undefined,'tandd-reading');}
 if(!response.ok){
  await response.body?.cancel();
  if(response.status===429){
   const reset=response.headers.get('x-ratelimit-reset');
   throw new CollectionError('RATE_LIMITED',reset&&/^\d{1,5}$/.test(reset)?Math.max(1,Number(reset)):120,'tandd-reading');
  }
  throw new CollectionError(response.status===401?'CREDENTIAL_REJECTED':response.status===403?'ACCESS_OR_RATE_LIMIT':'PROVIDER_UNAVAILABLE',undefined,'tandd-reading');
 }
 if(response.url&&response.url!==endpoint||!response.headers.get('content-type')?.toLowerCase().includes('application/json')){
  await response.body?.cancel();throw new CollectionError('INVALID_RESPONSE',undefined,'tandd-reading');
 }
 const parsed=current.safeParse(await readBoundedJson(response,65536));
 if(!parsed.success)throw new CollectionError('INVALID_RESPONSE',undefined,'tandd-reading');
 const device=parsed.data.devices[0];
 if(device?.serial.toUpperCase()!==target.record)throw new CollectionError('TARGET_MISMATCH',undefined,'tandd-reading');
 const channels=device.channel.filter(row=>row.num===target.scope);
 if(channels.length!==1)throw new CollectionError('TARGET_MISMATCH',undefined,'tandd-reading');
 const {unit,value}=channels[0];
 const numeric=/^[+-]?\d+(?:\.\d+)?$/.test(value)?Number(value):NaN;
 const celsius=['C','°C'].includes(unit)&&Number.isFinite(numeric)?numeric:undefined;
 const sampleMs=/^[1-9]\d{0,10}$/.test(device.unixtime)?Number(device.unixtime)*1000:NaN;
 return temperatureObservation({engine:'tandd-webstorage-temperature-1.0.0',source:endpoint,reference:target.reference,
  celsius,sampleMs,certificateHash,temperatureLabel:'Selected channel temperature within limits',
  limitation:'Latest reported measurement for T&D serial '+target.record+', channel '+target.scope+'. A Celsius channel and a numeric reading are required. Time between samples is unobserved.'});
}
