import test from 'node:test';
import assert from 'node:assert/strict';
import {WORK_VIEWS,parseWorkCreate,readWorkJson,parseWorkStart,parseWorkQuery,parseWorkPlan,workDate,planningBlock,taskWorkflow,safeWorkSource} from '../lib/work-hub.mjs';
const id='123e4567-e89b-42d3-a456-426614174000',other='123e4567-e89b-42d3-a456-426614174001';
const input=()=>({items:[{id,updatedAt:'2026-11-18T00:00:00.000Z'}],changes:{assigneeId:other,dueDate:'2026-12-01'},reason:'Rebalancing the documented workload with the team.'});
test('all work views and pagination are explicit and bounded',()=>{
 for(const view of Object.keys(WORK_VIEWS))assert.equal(parseWorkQuery(new URLSearchParams({view,page:'8'})).view,view);
 assert.deepEqual(parseWorkQuery(new URLSearchParams()),{view:'open',q:'',page:1});
 for(const page of ['0','-1','1.1','Infinity','1e5','1000000'])assert.throws(()=>parseWorkQuery(new URLSearchParams({page})));
 for(const view of ['__proto__','constructor','everything'])assert.throws(()=>parseWorkQuery(new URLSearchParams({view})));
 assert.throws(()=>parseWorkQuery(new URLSearchParams({q:'x'.repeat(121)})));
});
test('planning only accepts assignee/deadline fields, never status or approval',()=>{
 assert.equal(parseWorkPlan(input()).changes.assigneeId,other);
 for(const key of ['status','completionRationale','reviewStatus','organizationId','ownerName'])assert.throws(()=>parseWorkPlan({...input(),changes:{[key]:'COMPLETE'}}));
 assert.throws(()=>parseWorkPlan({...input(),changes:{}}));
 assert.throws(()=>parseWorkPlan({...input(),role:'OWNER'}));
});
test('invalid dates, forged versions and excessive selections are rejected',()=>{
 for(const date of ['2026-02-30','2026-13-01','2026-1-1','1999-12-31','2101-01-01'])assert.throws(()=>workDate(date));
 assert.equal(workDate('2028-02-29'),'2028-02-29');
 assert.throws(()=>parseWorkPlan({...input(),items:[{id,updatedAt:'yesterday'}]}));
 assert.throws(()=>parseWorkPlan({...input(),items:[...input().items,...input().items]}));
 assert.throws(()=>parseWorkPlan({...input(),items:Array(26).fill(input().items[0])}));
 assert.throws(()=>parseWorkPlan({...input(),items:[]}));
 assert.throws(()=>parseWorkPlan({...input(),reason:'OK'}));
 assert.throws(()=>parseWorkPlan({...input(),token:'forged'}));
});
test('planning supports explicit unassignment without coercing missing fields',()=>{
 const plan=parseWorkPlan({...input(),changes:{assigneeId:null}});assert.deepEqual(plan.changes,{assigneeId:null});
 assert.deepEqual(parseWorkPlan({...input(),changes:{dueDate:'2026-12-02'}}).changes,{dueDate:'2026-12-02'});
 assert.throws(()=>parseWorkPlan({...input(),changes:{assigneeId:''}}));
});
test('specialist work and completed records cannot be casually replanned',()=>{
 const task={id,status:'OPEN'};assert.equal(planningBlock(task),null);
 for(const field of ['changeAction','auditRequest','accessItem'])assert.ok(planningBlock({...task,[field]:{}}));
 assert.ok(planningBlock({...task,status:'COMPLETE'}));
});
test('workflow links keep the organisation and take specialist work to its own review',()=>{
 const task={id,status:'OPEN'};
 assert.match(taskWorkflow({...task,originKey:'source'},other).href,/\/team\/assurance\?organizationId=.*&taskId=/);
 assert.match(taskWorkflow({...task,changeAction:{responseId:id}},other).href,/\/team\/changes\?/);
 assert.match(taskWorkflow({...task,auditRequest:{}},other).href,/\/team\/audit-requests\?/);
 assert.match(taskWorkflow({...task,accessItem:{}},other).href,/\/team\/access-reviews\?/);
 assert.ok(taskWorkflow(task,other).href.includes(other));
});
test('task progress keeps file review and independent content review distinct',()=>{
 const task={id,status:'OPEN',originKey:'source'},base={role:'ADMIN',evidenceCount:0,pendingFiles:false,reviewableFiles:false,sourceLinked:true};
 assert.equal(taskWorkflow(task,other,base).stage,'EVIDENCE_REQUIRED');
 const file={...base,evidenceCount:1,pendingFiles:true,reviewableFiles:true};
 assert.equal(taskWorkflow(task,other,file).stage,'FILE_REVIEW');
 assert.equal(taskWorkflow(task,other,{...file,reviewableFiles:false}).actor,'teammate');
 assert.equal(taskWorkflow(task,other,{...file,role:'EDITOR'}).actor,'reviewer');
 assert.equal(taskWorkflow(task,other,{...file,pendingFiles:false}).stage,'ASSESSMENT_REQUIRED');
 const draft={...base,evidenceCount:1,assessment:{id:other,status:'DRAFT',independent:true,current:true,reason:null}};
 const action=taskWorkflow(task,other,draft);
 assert.equal(action.stage,'ASSESSMENT_REVIEW');assert.equal(action.actor,'you');
 const url=new URL(action.href,'https://example.invalid');
 assert.equal(url.searchParams.get('organizationId'),other);assert.equal(url.searchParams.get('taskId'),id);assert.equal(url.searchParams.get('assessmentId'),other);
 assert.equal(taskWorkflow(task,other,{...draft,assessment:{...draft.assessment,independent:false}}).actor,'teammate');
 assert.equal(taskWorkflow(task,other,{...draft,assessment:{...draft.assessment,current:false,reason:'Supporting context changed'}}).stage,'ASSESSMENT_CHECK');
 assert.equal(taskWorkflow({...task,status:'COMPLETE'},other,draft).stage,'ASSESSMENT_REVIEW','closing a task does not dispose of its pending assessment');
});
test('task progress never turns attachment or accepted-status metadata into completion readiness',()=>{
 const task={id,status:'OPEN',originKey:'source'},base={role:'OWNER',evidenceCount:1,pendingFiles:false,reviewableFiles:false,sourceLinked:true,assessment:{id:other,status:'ACCEPTED',independent:true,current:null,reason:null}};
 assert.equal(taskWorkflow(task,other,base).stage,'COMPLETION_CHECK');
 assert.equal(taskWorkflow(task,other,base).verified,false);
 const checked={...base,assessment:{...base.assessment,current:true},completion:{checked:true,ready:true,blockers:[]}};
 assert.equal(taskWorkflow(task,other,checked).stage,'READY_TO_COMPLETE');
 assert.equal(taskWorkflow(task,other,{...checked,role:'VIEWER'}).stage,'COMPLETION_CHECK');
 assert.notEqual(taskWorkflow(task,other,{...checked,completion:{...checked.completion,checked:false}}).stage,'READY_TO_COMPLETE');
 assert.equal(taskWorkflow(task,other,{...checked,assessment:{...base.assessment,current:false,reason:'The evidence review period has expired'}}).stage,'ASSESSMENT_CHECK');
 assert.equal(taskWorkflow(task,other,{...base,sourceLinked:false,sourceMissing:true}).stage,'SOURCE_REVIEW','an origin marker alone is not an accepted source decision');
 const changed={...checked,completion:{checked:true,ready:false,blockers:[{code:'SOURCE_REVIEWER_CHANGED',message:'Source reviewer is no longer authorised.',label:'Review source',href:'/team/sources?organizationId='+other}]}};
 assert.equal(taskWorkflow(task,other,changed).stage,'SOURCE_REVIEW');
 assert.equal(taskWorkflow({...task,status:'COMPLETE'},other,base).stage,'COMPLETED');
});
test('external source references cannot execute scripts or expose URL credentials',()=>{
 for(const value of ['javascript:alert(1)','data:text/html,test','http://example.invalid','https://secret@example.invalid','//example.invalid',null])assert.equal(safeWorkSource(value),null);
 assert.equal(safeWorkSource('https://www.gov.uk/example'),'https://www.gov.uk/example');
});

test('starting work requires the exact observed version and cannot set completion',()=>{
 const value={id,updatedAt:'2026-11-18T00:00:00.000Z'};
 assert.deepEqual(parseWorkStart(value),value);
 for(const bad of [null,[],{}, {...value,status:'COMPLETE'}, {...value,updatedAt:'yesterday'}, {...value,id:'wrong'}])assert.throws(()=>parseWorkStart(bad));
});

test('request body is byte-bounded even for streamed bodies and multibyte text',async()=>{
 const req=body=>new Request('https://example.invalid',{method:'POST',body});
 assert.deepEqual(await readWorkJson(req('{"a":1}')),{a:1});
 await assert.rejects(()=>readWorkJson(req('invalid')),SyntaxError);
 await assert.rejects(()=>readWorkJson(req(JSON.stringify({s:'£'.repeat(9000)}))),(e)=>e.status===413);
 await assert.rejects(()=>readWorkJson(req(new Uint8Array([255]))),(e)=>e.status===400);
 const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(8001));c.enqueue(new Uint8Array(8001));c.close();}});
 await assert.rejects(()=>readWorkJson(new Request('https://example.invalid',{method:'POST',body:stream,duplex:'half'})),(e)=>e.status===413);
});

test('new work has a real assignee and cannot choose approval or completion',()=>{
 const value={title:'  New task  ',category:'Quality',notes:'Working notes',dueDate:'2026-12-01',assigneeId:id};
 assert.equal(parseWorkCreate(value).title,'New task');
 for(const bad of [null,{}, {...value,status:'COMPLETE'}, {...value,assigneeId:null}, {...value,title:' '}, {...value,notes:'a'.repeat(501)}])assert.throws(()=>parseWorkCreate(bad));
});
