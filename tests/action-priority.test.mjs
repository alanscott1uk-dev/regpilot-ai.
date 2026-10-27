import test from "node:test";
import assert from "node:assert/strict";
import {actionPriority,actionSummary,daysUntil} from "../lib/action-priority.mjs";
const today="2026-10-27";
test("priority follows due date rather than an arbitrary compliance score",()=>{
 assert.equal(actionPriority({due:"2026-10-26",status:"Open"},today),"Overdue");
 assert.equal(actionPriority({due:"2026-10-30",status:"Open"},today),"Urgent");
 assert.equal(actionPriority({due:"2026-11-10",status:"Open"},today),"Upcoming");
 assert.equal(actionPriority({due:"2027-01-01",status:"Open"},today),"Scheduled");
});
test("completed action is not overdue",()=>{
 assert.equal(actionPriority({due:"2026-10-01",status:"Complete"},today),"Complete");
});
test("invalid dates never create fake urgency",()=>{
 assert.equal(daysUntil("2026-02-30",today),null);
 assert.equal(actionPriority({due:"",status:"Open"},today),"Unknown");
});
test("summary reconciles with all actions",()=>{
 const list=[{due:"2026-10-26",status:"Open"},{due:"2026-10-30",status:"Open"},{due:"2026-10-01",status:"Complete"}];
 const counts=actionSummary(list,today);
 assert.equal(counts.overdue,1);assert.equal(counts.urgent,1);assert.equal(counts.complete,1);
});
