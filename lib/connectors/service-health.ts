import {z} from 'zod';
import {providerReader,booleanCheck} from './bounded-http';
import {CollectionError} from './collection-error';
import {atStep} from './collection-step';
import type {Observation} from './observation';

const pagerId=z.string().regex(/^P[A-Z0-9]{6,19}$/);
export const serviceHealthTargets={
 PAGERDUTY_SERVICE:z.object({scope:z.string().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(?:eu\.)?pagerduty\.com$/),record:pagerId,reference:pagerId}),
 HEALTHCHECKS_JOB:z.object({scope:z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),record:z.string().regex(/^[a-f0-9]{40}$/),reference:z.string().regex(/^[1-9]\d{0,5}$/).refine(n=>Number(n)<=525600)})
};
type Target={scope:string;record:string;reference:string};
export async function collectServiceHealth(provider:keyof typeof serviceHealthTargets,target:Target,token:string,fetcher:typeof fetch):Promise<Observation>{
 const {scope,record,reference}=serviceHealthTargets[provider].parse(target);
 const capturedAt=new Date().toISOString();
 if(provider==='PAGERDUTY_SERVICE'){
  const api=scope.endsWith('.eu.pagerduty.com')?'https://api.eu.pagerduty.com':'https://api.pagerduty.com';
  const sourceUrl=api+'/services/'+record;
  const read=providerReader(fetcher,{Authorization:'Token token='+token,Accept:'application/vnd.pagerduty+json;version=2'});
  const service=(await atStep('pagerduty-service',()=>read(sourceUrl)))!.body?.service;
  if(service?.id!==record||service.type!=='service'||service.self!==sourceUrl||typeof service.html_url!=='string'||!service.html_url.startsWith('https://'+scope+'/'))
   throw new CollectionError('TARGET_MISMATCH',undefined,'pagerduty-service');
  const state=z.enum(['active','warning','critical','maintenance','disabled']).safeParse(service.status).data;
  const escalation=pagerId.safeParse(service.escalation_policy?.id).data;
  return {engine:'pagerduty-service-1',sourceUrl,capturedAt,checks:[
   {...booleanCheck('service-state','Service has no open incident and is active',state?state==='active':undefined,true,'Review the service status and open incidents.'),observed:state??'Unknown service status'},
   {...booleanCheck('service-escalation','Service uses the approved escalation policy',escalation?escalation===reference:undefined,true,'Reconcile the assigned escalation policy with the approved service configuration.'),observed:escalation??'Policy unavailable'}
  ],limitations:['Covers the selected service status and escalation policy at collection time.']};
 }
 const sourceUrl='https://healthchecks.io/api/v3/checks/'+record;
 const read=providerReader(fetcher,{'X-Api-Key':token});
 const check=(await atStep('healthchecks-job',()=>read(sourceUrl)))!.body;
 if(check?.unique_key!==record||check.slug!==scope||'ping_url' in check||'uuid' in check)
  throw new CollectionError('TARGET_MISMATCH',undefined,'healthchecks-job');
 const state=z.enum(['new','up','grace','down','paused']).safeParse(check.status).data;
 const last=z.iso.datetime({offset:true}).safeParse(check.last_ping).data;
 const age=last?Date.parse(capturedAt)-Date.parse(last):NaN;
 return {engine:'healthchecks-heartbeat-1',sourceUrl,capturedAt,checks:[
  {...booleanCheck('heartbeat-state','Monitored job is up',state?state==='up':undefined,true,'Inspect the job schedule and its latest ping.'),observed:state??'Unknown job status'},
  {...booleanCheck('heartbeat-age','Last ping within the site maximum age',Number.isFinite(age)&&age>=0?age<=Number(reference)*60000:check.last_ping===null?false:undefined,true,'Check job execution and the site-approved maximum age.'),observed:last??'No verified timestamp'}
 ],limitations:['The project-scoped read-only response confirms a heartbeat. Investigate the underlying job separately.']};
}
