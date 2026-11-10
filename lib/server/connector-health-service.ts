import {db} from "./db";
import {requireMember} from "./workspace-member";
import type {AuthorizedContext} from "./authorization";
import {hashValue} from "../regulatory/intelligence";
import {connectorProviderEnabled} from "./connector-flags";
import {connectorHealth} from "../connectors/health-dashboard.mjs";

export async function getConnectorHealth(ctx:AuthorizedContext){
 const records=await db.$transaction(async tx=>{
  await requireMember(tx,ctx);
  return tx.evidenceConnector.findMany({where:{organizationId:ctx.organizationId},orderBy:{createdAt:"desc"},take:21,
   select:{id:true,provider:true,repository:true,branch:true,version:true,enabled:true,intervalHours:true,failureCode:true,lastSuccessAt:true,
    runs:{orderBy:[{capturedAt:"desc"},{id:"desc"}],take:1,
     select:{configVersion:true,result:true,resultHash:true,capturedAt:true,outcome:true}}}});
 },{isolationLevel:"RepeatableRead",timeout:12000});
 const rows=records.slice(0,20).map(r=>{
  const latest=r.runs[0],integrityValid=!!latest&&hashValue(latest.result)===latest.resultHash;
  const raw=integrityValid&&latest?.result&&typeof latest.result==="object"&&!Array.isArray(latest.result)
   ?latest.result as Record<string,unknown>:null;
  const checks=Array.isArray(raw?.checks)?raw.checks:[];
  return {id:r.id,provider:r.provider,target:r.provider+" · "+r.repository.replace(/^([a-z]+):/,"")+" · "+r.branch,
   version:r.version,enabled:r.enabled,providerAvailable:connectorProviderEnabled(r.provider),
   lastSuccessAt:r.lastSuccessAt?.toISOString()||null,lastCapturedAt:latest?.capturedAt.toISOString()||null,
   intervalHours:r.intervalHours,failureCode:r.failureCode,observedVersion:latest?.configVersion||null,
   integrityValid,lastOutcome:latest?.outcome||null,
   checksFailed:checks.filter(c=>c&&typeof c==="object"&&!Array.isArray(c)&&c.status==="FAIL").length,
   checksUnknown:checks.filter(c=>c&&typeof c==="object"&&!Array.isArray(c)&&c.status==="UNKNOWN").length};
 });
 return {...connectorHealth(rows),listLimitReached:records.length>20};
}
