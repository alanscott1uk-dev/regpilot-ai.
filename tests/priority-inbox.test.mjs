import test from "node:test";
import assert from "node:assert/strict";
import {priorityInbox, firstRunSteps,taskDestination} from "../lib/priority-inbox.mjs";

test("change actions open the exact response and action ahead of generic evidence routing",()=>{
 const task={id:"task",originKey:"response",changeAction:{id:"action",responseId:"response"}};
 assert.equal(taskDestination(task,"org"),"/team/changes?organizationId=org&responseId=response&actionId=action");
 const q=priorityInbox({organizationId:"org",tasks:[{...task,title:"Resolve source update",status:"OPEN"}]});
 assert.equal(q.items[0].href,taskDestination(task,"org"));
 assert.equal(q.items[0].kind,"Change response");
 assert.equal(taskDestination({...task,changeAction:null},"org"),"/team/assurance?organizationId=org&taskId=task");
 assert.equal(taskDestination({id:"task"},"org"),"/team?taskId=task");
 assert.ok(taskDestination({...task,changeAction:{id:"a&b",responseId:"r?x"}},"o&x").includes("organizationId=o%26x&responseId=r%3Fx&actionId=a%26b"));
});

const fixture = () => ({
 organizationId:"01234567-89ab-4cde-8f01-123456789abc",generatedAt:"2026-11-09T11:00:00Z",
 summary:{policyReading:1,vendorReviewsDue:2,evidencePending:3,monitoringAttention:1},
 sourceImpact:{tasks:[{taskId:"one",title:"UK regulator update"}]},
 tasks:[
  {id:"one",title:"Source follow up",dueDate:"2026-11-01T00:00:00Z",status:"OPEN",ownerName:"Quality lead"},
  {id:"two",title:"Overdue review",dueDate:"2026-11-07T00:00:00Z",status:"OPEN",ownerName:"Owner"},
  {id:"three",title:"Next week",dueDate:"2026-11-12T00:00:00Z",status:"IN_PROGRESS",ownerName:"Analyst"},
  {id:"done",title:"Completed task",dueDate:"2026-11-01T00:00:00Z",status:"COMPLETE"}],
 assessments:[{id:"a",obligationId:"two",validUntil:"2026-11-08T00:00:00Z",obligation:{title:"Evidence assessment"}}],
 connectors:[{id:"c",failureCode:"AUTH_FAILED",stale:true},{id:"d",failureCode:null,stale:true}],
 controls:[], evidence:[], imports:[],taskLimitReached:true
});

test("one source revision beats an overdue task and does not duplicate its task",()=>{
 const q=priorityInbox(fixture(),"2026-11-09");
 assert.equal(q.items[0].kind,"Source changed");
 assert.equal(q.items[0].href,"/team/intelligence");
 assert.equal(q.items.filter(x=>x.id==="task:one").length,0);
 assert.equal(q.items[1].kind,"Overdue task");
 assert.equal(q.shownTaskLimit,true);
 assert.equal(q.items.some(x=>x.id==="task:done"),false);
});
test("stale and failed evidence never imply passing; older accepted assessments need review",()=>{
 const q=priorityInbox(fixture(),"2026-11-09");
 assert.ok(q.items.some(x=>x.kind==="Collection failed"));
 assert.ok(q.items.some(x=>x.kind==="Observation stale"));
 assert.ok(q.items.some(x=>x.kind==="Review expired"));
 assert.ok(q.items.some(x=>x.href.includes("organizationId=")));
 assert.ok(q.items.some(x=>x.href.includes("/team/evidence")));
});
test("no inventory means no invented compliance score or critical findings",()=>{
 const q=priorityInbox({tasks:[],summary:{},connectors:[],assessments:[],sourceImpact:{tasks:[]}}, "2026-11-09");
 assert.equal(q.unresolved,0);
 assert.equal(q.urgent,0);
 assert.deepEqual(q.items,[]);
});
test("first-run guidance stops showing completed setup steps",()=>{
 assert.deepEqual(firstRunSteps(fixture()).map(x=>x.key),["controls","evidence","programme"]);
 const f=fixture();f.controls=[{id:"control"}];f.evidence=[{id:"file"}];f.imports=[{id:"p"}];
 assert.deepEqual(firstRunSteps(f),[]);
});
test("incomplete or invalid dates cannot manufacture an overdue deadline",()=>{
 const f=fixture();f.tasks=[{id:"unknown",title:"Undated task",dueDate:"not a date",status:"OPEN"}];f.sourceImpact={tasks:[]};
 const q=priorityInbox(f,"2026-11-09"),t=q.items.find(x=>x.id==="task:unknown");
 assert.equal(t.kind,"Team task");
 assert.match(t.detail,/date not recorded/);
});
