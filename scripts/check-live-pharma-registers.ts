import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {collectPublicRegister,referenceRegisters} from '../lib/connectors/pharma-registers';
import {observationSchema} from '../lib/connectors/observation';

async function main(){
 const runs=await Promise.allSettled(referenceRegisters.map(async({provider,target})=>{
  const reads=[];
  for(let i=0;i<2;i++){
   const observation=observationSchema.parse(await collectPublicRegister(provider,target));
   console.log(provider,observation.checks.map(c=>[c.id,c.status,c.observed]));
   assert.ok(observation.checks.every(c=>c.status!=='UNKNOWN'),provider+' returned incomplete evidence');
   reads.push({observation,sha256:createHash('sha256').update(JSON.stringify(observation)).digest('hex')});
  }
  return {provider,target,reads};
 }));
 const accepted=runs.flatMap(r=>r.status==='fulfilled'?[r.value]:[]);
 await writeFile('live-pharma-registers.json',JSON.stringify({accepted,scope:'Acceptance reads from the public APIs. Interval-qualified monitoring is tracked separately.'},null,2));
 const failures=runs.flatMap((r,i)=>r.status==='rejected'?[referenceRegisters[i].provider+': '+String(r.reason?.code??r.reason)]:[]);
 if(failures.length)throw Error(failures.join('\n'));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
