import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {loadPolicy} from '@open-policy-agent/opa-wasm';
import {z} from 'zod';
import manifest from '../policies/connected-control.json';
import {hashValue} from '../regulatory/intelligence';
import {observationCurrent} from '../connectors/observation';
import {verifiedObservation} from './connector-observation';
import {connectorProviderEnabled} from './connector-flags';
import {requireMember,ADMIN} from './workspace-member';
import {IntelligenceError} from './intelligence-service';
import type {AuthorizedContext} from './authorization';
import {db} from './db';

const requestSchema=z.object({controlId:z.uuid(),minimumProviders:z.number().int().min(1).max(5)}).strict();
const rowLimit=100;
const resultSchema=z.object({state:z.enum(['FINDINGS','INSUFFICIENT_EVIDENCE','BELOW_TARGET','MEETS_TARGET']),providers:z.array(z.string()),failingConnections:z.array(z.uuid()),unverifiedConnections:z.array(z.uuid())}).strict();
type Status='UNKNOWN'|'FAILED'|'OBSERVED';
type Facts={minimumProviders:number;limited:boolean;observations:{connectorId:string;provider:string;status:Status}[]};
let compiled:Promise<WebAssembly.Module>|undefined;
async function compilePolicy(){
 const bytes=await readFile(path.join(process.cwd(),'lib/policies/connected-control.wasm'));
 if(createHash('sha256').update(bytes).digest('hex')!==manifest.wasmSha256)throw Error('Control policy integrity check failed');
 return WebAssembly.compile(new Uint8Array(bytes));
}
export async function evaluateControlPolicy(facts:Facts){
 // Share immutable compiled code. Each evaluation receives its own memory and inputs.
 compiled??=compilePolicy().catch(error=>{compiled=undefined;throw error;});
 const policy=await loadPolicy(await compiled);
 const results=policy.evaluate(facts,'regpilot/control/decision');
 return resultSchema.parse(results[0]?.result);
}

export async function testConnectedControl(ctx:AuthorizedContext,input:unknown){
 const {controlId,minimumProviders}=requestSchema.parse(input);
 const snapshot=await db.$transaction(async tx=>{
  await requireMember(tx,ctx,ADMIN);
  const control=await tx.managedControl.findFirst({where:{organizationId:ctx.organizationId,id:controlId,enabled:true},select:{id:true,title:true,version:true}});
  if(!control)throw new IntelligenceError('Active control unavailable in this organisation',404);
  const checkedAt=new Date();
  const connections=await tx.evidenceConnector.findMany({
   where:{organizationId:ctx.organizationId,OR:[{controlId},{controlLinks:{some:{organizationId:ctx.organizationId,controlId}}}]},
   orderBy:{id:'asc'},take:rowLimit+1,select:{
    id:true,provider:true,version:true,enabled:true,intervalHours:true,failureCode:true,eventRevision:true,collectedEventRevision:true,
    runs:{orderBy:[{capturedAt:'desc'},{id:'desc'}],take:1,select:{id:true,configVersion:true,capturedAt:true,result:true,resultHash:true,signalHash:true,outcome:true}}
   }
  });
  const observations=connections.slice(0,rowLimit).map(connection=>{
   const run=connection.runs[0],valid=run&&verifiedObservation(run);
   let status:Status='UNKNOWN',reason='No verified current collection';
   if(!connection.enabled)reason=connection.failureCode?'Collection paused after failure':'Connection paused';
   else if(!connectorProviderEnabled(connection.provider))reason='Provider inactive';
   else if(connection.failureCode)reason='Collection failed';
   else if(connection.eventRevision!==connection.collectedEventRevision)reason='New provider event awaiting collection';
   else if(run&&!valid)reason='Observation integrity check failed';
   else if(run&&!observationCurrent(run,connection,true,checkedAt.getTime()))reason='Observation expired or configuration changed';
   else if(valid&&(Date.parse(valid.capturedAt)>checkedAt.getTime()||checkedAt.getTime()-Date.parse(valid.capturedAt)>=connection.intervalHours*3600000))reason='Provider observation outside the collection interval';
   else if(run&&valid){
    status=run.outcome==='OBSERVED'?'OBSERVED':run.outcome==='FOLLOW_UP'?'FAILED':'UNKNOWN';
    reason=status==='OBSERVED'?'Current collection passed its checks':status==='FAILED'?'Current collection contains a failed check':'Current collection has incomplete checks';
   }
   return {connectorId:connection.id,provider:connection.provider,status,reason,version:connection.version,runId:run?.id||null,observedVersion:run?.configVersion??null,sourceCapturedAt:valid?.capturedAt||null,capturedAt:run?.capturedAt.toISOString()||null,resultHash:valid?run.resultHash:null};
  });
  return {organizationId:ctx.organizationId,control,checkedAt:checkedAt.toISOString(),minimumProviders,observations,limited:connections.length>rowLimit};
 },{isolationLevel:'RepeatableRead',timeout:12000});
 const decision=await evaluateControlPolicy({minimumProviders,limited:snapshot.limited,observations:snapshot.observations.map(({connectorId,provider,status})=>({connectorId,provider:provider==="AWS_ORGANIZATIONS"?"AWS":provider,status}))});
 const receipt={...snapshot,policy:manifest,decision};
 return {...receipt,receiptHash:hashValue(receipt)};
}
