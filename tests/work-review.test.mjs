import test from 'node:test';
import assert from 'node:assert/strict';
import {parseWorkReviewQuery,parseWorkReviewFollowUp,parseWorkVerification} from '../lib/work-review.mjs';
const id='123e4567-e89b-42d3-a456-426614174000',token='a'.repeat(64);
const plan={phase:'preview',reviewToken:token,assigneeId:id,dueDate:'2027-02-28',reason:'Review the changed training proof and arrange independent approval.'};
test('review query is bounded and follow-up requires a separate confirmed plan',()=>{
 assert.deepEqual(parseWorkReviewQuery(new URLSearchParams('q=%20training%20&page=6')),{q:'training',page:6});
 for(const q of ['page=0','page=-1','page=1.5','page=1000000','q='+encodeURIComponent('x'.repeat(121))])assert.throws(()=>parseWorkReviewQuery(new URLSearchParams(q)),e=>e.status===400);
 assert.equal(parseWorkReviewFollowUp(plan).phase,'preview');
 assert.equal(parseWorkReviewFollowUp({...plan,phase:'apply',token,confirm:true}).confirm,true);
 for(const bad of [null,{...plan,phase:'create'},{...plan,reviewToken:'old'},{...plan,assigneeId:'foreign'},{...plan,dueDate:'2027-02-30'},{...plan,reason:'Done'},{...plan,reason:'x'.repeat(501)},{...plan,originKey:'bypass'},{...plan,controlId:id},{...plan,confirm:true},{...plan,phase:'apply',token,confirm:false},{...plan,phase:'apply',confirm:true}])assert.throws(()=>parseWorkReviewFollowUp(bad),e=>e.status===400);
});
test('fresh verification requires selected evidence, meaningful notes and explicit confirmation',()=>{
 const input={token,evidenceIds:[id],notes:'Rechecked the current task and independently approved supporting records.',confirm:true};
 assert.deepEqual(parseWorkVerification(input),input);
 for(const bad of [{...input,confirm:false},{...input,evidenceIds:[]},{...input,evidenceIds:[id,id]},{...input,notes:'OK'},{...input,originalTaskId:id}])assert.throws(()=>parseWorkVerification(bad),e=>e.status===400);
});
