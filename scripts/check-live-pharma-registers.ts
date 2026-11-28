import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {collectPublicRegister,referenceRegisters} from '../lib/connectors/pharma-registers';
import {CollectionError} from '../lib/connectors/collection-error';
import {observationSchema} from '../lib/connectors/observation';

async function main(){
 const failuresByAttempt:{provider:string;read:number;attempt:number;code:string;at:string}[]=[];
 const runs=await Promise.allSettled(referenceRegisters.map(async({provider,target})=>{
  const reads=[];
  for(let i=0;i<2;i++){
   const collect=()=>collectPublicRegister(provider,target);
   let reading;
   try{reading=await collect();}catch(e){
    if(!(e instanceof CollectionError))throw e;
    failuresByAttempt.push({provider,read:i+1,attempt:1,code:e.code,at:new Date().toISOString()});
    if(!['PROVIDER_UNAVAILABLE','PROVIDER_TIMEOUT'].includes(e.code))throw e;
    await new Promise(resolve=>setTimeout(resolve,5000));
    try{reading=await collect();}catch(last){
     if(last instanceof CollectionError)failuresByAttempt.push({provider,read:i+1,attempt:2,code:last.code,at:new Date().toISOString()});
     throw last;
    }
   }
   const observation=observationSchema.parse(reading);
   console.log(provider,observation.checks.map(c=>[c.id,c.status,c.observed]));
   assert.ok(observation.checks.every(c=>c.status!=='UNKNOWN'),provider+' returned incomplete evidence');
   reads.push({observation,sha256:createHash('sha256').update(JSON.stringify(observation)).digest('hex')});
  }
  return {provider,target,reads};
 }));
 const accepted=runs.flatMap(r=>r.status==='fulfilled'?[r.value]:[]);
 await writeFile('live-pharma-registers.json',JSON.stringify({accepted,failuresByAttempt,scope:'Acceptance reads from the public APIs. Interval-qualified monitoring is tracked separately.'},null,2));
 const failures=runs.flatMap((r,i)=>r.status==='rejected'?[referenceRegisters[i].provider+': '+String(r.reason?.code??r.reason)]:[]);
 if(failures.length)throw Error(failures.join('\n'));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
