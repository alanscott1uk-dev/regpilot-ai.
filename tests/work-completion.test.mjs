import test from 'node:test';
import assert from 'node:assert/strict';
import {parseWorkCompletion,selectedCompletionEvidence,COMPLETION_EVIDENCE_LIMIT} from '../lib/work-completion.mjs';

const a='123e4567-e89b-42d3-a456-426614174000',b='123e4567-e89b-42d3-a456-426614174001';
const valid={token:'a'.repeat(64),evidenceIds:[b,a],confirm:true,notes:'Completed the training review and checked the dated records.'};
test('completion requires explicit, bounded single-task confirmation and a current proof snapshot',()=>{
 assert.equal(COMPLETION_EVIDENCE_LIMIT,10);
 assert.deepEqual(parseWorkCompletion({...valid,notes:' '+valid.notes+' '}).evidenceIds,[a,b]);
 assert.equal(parseWorkCompletion(valid).notes,valid.notes);
 for(const input of [null,[],{}, {...valid,confirm:false},{...valid,confirm:'true'},{...valid,token:'stale'},{...valid,evidenceIds:[]},{...valid,evidenceIds:[a,a]},{...valid,evidenceIds:[a,a.toUpperCase()]},{...valid,evidenceIds:['foreign-id']},{...valid,notes:'Done'},{...valid,notes:'x'.repeat(501)},{...valid,notes:valid.notes+'\u0000'},{...valid,status:'COMPLETE'},{...valid,completionException:true},{...valid,items:[a,b]}]){
  assert.throws(()=>parseWorkCompletion(input),error=>error.status===400);
 }
 assert.throws(()=>parseWorkCompletion({...valid,evidenceIds:Array.from({length:11},(_,i)=>a.slice(0,-2)+String(i).padStart(2,'0'))}),error=>error.status===400);
});
test('source work requires the exact accepted manifest and ordinary work allows only eligible proof',()=>{
 const evidence=[{id:a},{id:b}];
 assert.deepEqual(selectedCompletionEvidence(evidence,[a]),[{id:a}]);
 assert.deepEqual(selectedCompletionEvidence(evidence,[b,a],true),evidence);
 assert.throws(()=>selectedCompletionEvidence(evidence,[a],true),error=>error.status===409);
 assert.throws(()=>selectedCompletionEvidence(evidence,['123e4567-e89b-42d3-a456-426614174002']),error=>error.status===409);
});
