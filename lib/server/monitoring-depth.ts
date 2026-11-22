import {z} from 'zod';
import type {Prisma} from '@prisma/client';
import {verifiedObservation} from './connector-observation';

const readEvent=z.object({runId:z.uuid(),scopeHash:z.string(),resultHash:z.string(),collectionMode:z.enum(['MANUAL','SCHEDULED','RETRY','INITIAL','EVENT']),configVersion:z.number()});
const failure=z.object({scopeHash:z.string(),configVersion:z.number(),code:z.string()});
type Capture={id:string;configVersion:number;capturedAt:Date;result:Prisma.JsonValue;resultHash:string;signalHash:string;outcome:string};
type Rotation={before:number;after:number;at:Date};
export async function monitoringDepth(tx:Prisma.TransactionClient,org:string,id:string,scopeHash:string,version:number,interval:number,captures:Capture[],rotations:Rotation[]){
 const where={organizationId:org,entityType:'EvidenceConnector',entityId:id,details:{path:['scopeHash'],equals:scopeHash}};
 const [success,failed]=await Promise.all([
  tx.auditEvent.findMany({where:{...where,action:'connector.evidence_collected'},orderBy:[{createdAt:'desc'},{id:'desc'}],take:101,select:{details:true}}),
  tx.auditEvent.findMany({where:{...where,action:'connector.collection_failed'},orderBy:[{createdAt:'desc'},{id:'desc'}],take:101,select:{id:true,details:true,createdAt:true}})
 ]);
 const byId=new Map(captures.map(r=>[r.id,r]));
 const reads=success.slice(0,100).flatMap(e=>{
  const p=readEvent.safeParse(e.details);if(!p.success)return [];
  const r=byId.get(p.data.runId),obs=verifiedObservation(r);
  if(!r||!obs||r.resultHash!==p.data.resultHash||r.configVersion!==p.data.configVersion||!obs.checks.length)return [];
  return [{id:r.id,at:r.capturedAt.toISOString(),version:r.configVersion,mode:p.data.collectionMode,
   hash:r.resultHash,checks:obs.checks.map(c=>({id:c.id,label:c.label,status:c.status}))}];
 });
 const failures=failed.slice(0,100).flatMap(e=>{const p=failure.safeParse(e.details);return p.success?[{id:e.id,at:e.createdAt.toISOString(),version:p.data.configVersion,code:p.data.code}]:[];});
 const scheduled=reads.filter(r=>r.mode==='SCHEDULED'&&r.version===version&&r.checks.every(c=>c.status!=='UNKNOWN'));
 const cadence=scheduled.some((newer,i)=>scheduled.slice(i+1).some(older=>{
  const delta=Date.parse(newer.at)-Date.parse(older.at);
  return delta>=interval*3600000-1000&&delta<=(interval*60+30)*60000&&older.checks.length===newer.checks.length&&
   older.checks.every(c=>newer.checks.some(n=>n.id===c.id));
 }));
 const recoveries=rotations.filter(r=>r.after===version).flatMap(change=>{
  const incident=failures.find(f=>f.version===change.before&&f.code==='CREDENTIAL_REJECTED'&&Date.parse(f.at)<=change.at.getTime());
  if(!incident)return [];
  const before=reads.find(r=>r.version===change.before&&Date.parse(r.at)<=Date.parse(incident.at));
  const after=reads.find(r=>r.version===change.after&&Date.parse(r.at)>=change.at.getTime()&&r.checks.every(c=>c.status!=='UNKNOWN'));
  return before&&after?[{before:before.id,failure:incident.id,replacedAt:change.at.toISOString(),after:after.id}]:[];
 });
 return {reads,failures,scheduledReads:scheduled.length,cadence,recoveries,limited:success.length>100||failed.length>100||captures.length>100};
}
