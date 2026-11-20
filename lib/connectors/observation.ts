import {z} from 'zod';
import type {ConnectorCheck} from "./github";
export type Observation={engine:string;sourceUrl:string;capturedAt:string;checks:ConnectorCheck[];limitations:string[]};
export type SignalChange={id:string;label:string;before:string;after:string;observedBefore:string;observedAfter:string};
export const observationSchema=z.object({
 engine:z.string().min(1).max(160),sourceUrl:z.url().refine(v=>new URL(v).protocol==='https:'),capturedAt:z.iso.datetime(),
 checks:z.array(z.object({id:z.string().min(1).max(160),label:z.string().max(500),status:z.enum(['PASS','FAIL','UNKNOWN']),observed:z.string().max(4000),nextStep:z.string().max(2000),sourceUrl:z.url().max(2048).refine(v=>{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password;}).optional()})).max(200)
  .refine(checks=>new Set(checks.map(c=>c.id)).size===checks.length,'Check identifiers must be unique'),
 limitations:z.array(z.string().max(4000)).max(100)
});
/** Lost coverage remains UNKNOWN until the same engine actually returns it again. */
export function reconcileObservation(current:Observation,previous:Observation|null):Observation{
 const parsed=observationSchema.parse(current);
 if(!previous||previous.engine!==parsed.engine)return parsed;
 const ids=new Set(parsed.checks.map(c=>c.id));
 const missing=previous.checks.filter(c=>!ids.has(c.id)).map(c=>({...c,status:'UNKNOWN' as const,observed:'Not returned by the latest collection',nextStep:'Restore collection coverage and review this signal before relying on it.'}));
 const combined=[...parsed.checks,...missing];
 if(combined.length<=200)return observationSchema.parse({...parsed,checks:combined});
 // Never let a changing inventory exceed the storage contract or hide a current failure.
 const retained=combined.filter(c=>c.id!=="historical-coverage-limit").slice(0,199);
 const kept=new Set(retained.map(c=>c.id)),omitted=combined.filter(c=>!kept.has(c.id));
 return observationSchema.parse({...parsed,checks:[...retained,{id:"historical-coverage-limit",label:"Additional coverage requires review",
  status:omitted.some(c=>c.status==="FAIL")?"FAIL":"UNKNOWN",observed:omitted.length+" check records exceed the retained inventory limit.",
  nextStep:"Compare previous collection records. Review the scope before establishing a new configuration baseline."}]});
}
export function signalChanges(current:Observation,previous:Observation|null):SignalChange[]{
 if(!previous)return [];
 if(previous.engine!==current.engine)return [{id:'collector-engine',label:'Collection method changed',before:previous.engine,after:current.engine,observedBefore:'Previous collection method',observedAfter:'Review the new method and its coverage before relying on these observations'}];
 const currentIds=new Set(current.checks.map(c=>c.id));
 return [
  ...current.checks.flatMap(check=>{const old=previous.checks.find(c=>c.id===check.id);return !old||old.status!==check.status||old.observed!==check.observed?[{id:check.id,label:check.label,before:old?.status||'NOT_OBSERVED',after:check.status,observedBefore:old?.observed||'Not previously collected',observedAfter:check.observed}]:[];}),
  ...previous.checks.filter(c=>!currentIds.has(c.id)).map(c=>({id:c.id,label:c.label,before:c.status,after:'UNKNOWN',observedBefore:c.observed,observedAfter:'Not returned by the latest collection'}))
 ];
}
export function observationOutcome(value:Observation){return value.checks.some(c=>c.status==="FAIL")?"FOLLOW_UP":!value.checks.length||value.checks.some(c=>c.status==="UNKNOWN")?"INCOMPLETE":"OBSERVED";}
export function connectorLabel(row:{provider:string;repository:string;branch:string}){
 if(row.provider==="WORKFORCE_LEAVER"){const [,site,employee,,issue]=row.repository.split(":");return "BambooHR "+site+" · leaver "+employee+" · Jira "+issue;}
 if(row.provider==="AWS_ORGANIZATIONS")return "AWS organization "+row.repository.split(":")[1]+" · "+row.branch;
 if(row.provider==="AWS")return "AWS · "+row.repository.slice(4)+" · "+row.branch;
 if(row.provider==="GLEIF")return "GLEIF · "+row.branch+" · "+row.repository.slice(6);
 if(row.provider==="INTUNE")return "Microsoft Intune · "+row.repository.slice(7);if(row.provider==="OPENSSF_SCORECARD")return "OpenSSF · "+row.repository.slice(10)+(row.branch==="published"?"":" · "+row.branch.slice(0,12));return row.provider==="OKTA"?"Okta group · "+row.branch.split(":")[0]:row.provider==="VERCEL"?"Vercel · "+row.repository.slice(7):row.provider==="SUPABASE"?"Supabase · "+row.repository.slice(9):row.provider==="GITLAB"?"GitLab · "+row.repository.replace(/^gitlab:/,"")+" · "+row.branch:row.provider==="CLOUDFLARE"?"Cloudflare zone · "+row.repository.replace(/^cloudflare:/,""):row.provider==="COMPANIES_HOUSE"?"Companies House · "+row.repository.replace(/^companieshouse:/,""):row.provider==="GOOGLE_WORKSPACE"?"Google Workspace · "+row.repository.replace(/^googleworkspace:/,""):row.provider==="MICROSOFT365"?"Microsoft 365 · "+row.repository.replace(/^microsoft365:/,""):row.repository+" · "+row.branch;}
export function observationCurrent(row:{configVersion:number;capturedAt:Date},connector:{version:number;enabled:boolean;failureCode:string|null;intervalHours:number},latest:boolean,now=Date.now()){const age=now-row.capturedAt.getTime();return Number.isFinite(age)&&age>=0&&[24,168].includes(connector.intervalHours)&&latest&&row.configVersion===connector.version&&connector.enabled&&!connector.failureCode&&age<connector.intervalHours*3600000;}
