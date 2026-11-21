import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAssuranceRenewal} from '../lib/server/assurance-service';
const now=new Date('2026-11-18T12:00:00.000Z');
const valid={version:2,notes:'Independently rechecked the unchanged requirement, original evidence, business scope and implementation dates.',passageKeys:['a'.repeat(64)],validUntil:'2026-12-18',scopeConfirmed:true,originalsChecked:true};
test('renewal requires an explicit versioned human decision with bounded notes, exact passages and a future review date',()=>{
 const parsed=parseAssuranceRenewal({...valid,notes:'  '+valid.notes+'  '},now);
 assert.equal(parsed.notes,valid.notes);assert.equal(parsed.validUntil.toISOString(),'2026-12-18T23:59:59.999Z');assert.deepEqual(parsed.passageKeys,valid.passageKeys);
 for(const raw of [null,[],{...valid,method:'AI'},{...valid,inputHash:'f'.repeat(64)},{...valid,version:0},{...valid,version:2.5},{...valid,version:Number.MAX_SAFE_INTEGER+1},{...valid,notes:'Too short'},{...valid,notes:'x'.repeat(1201)},{...valid,notes:valid.notes+'\u0000'},{...valid,scopeConfirmed:false},{...valid,originalsChecked:'true'},{...valid,passageKeys:[]},{...valid,passageKeys:[valid.passageKeys[0],valid.passageKeys[0]]},{...valid,passageKeys:Array.from({length:9},(_,i)=>String(i).repeat(64))},{...valid,passageKeys:['invented']},{...valid,validUntil:'2026-11-17'},{...valid,validUntil:'2026-02-30'},{...valid,validUntil:'2027-03-01'},{...valid,validUntil:'2026-12-18T00:00:00Z'}]){
  assert.throws(()=>parseAssuranceRenewal(raw,now),(error:any)=>error.status===400);
 }
 assert.throws(()=>parseAssuranceRenewal({...valid,validUntil:'2026-12-18'},new Date('2026-12-19T00:00:00Z')),(error:any)=>error.status===400,'the deadline is rechecked after document I/O');
});
