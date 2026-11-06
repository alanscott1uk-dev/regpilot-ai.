import test from "node:test";
import assert from "node:assert/strict";
import {recordUrgency,sortRecords,filterRecords,parseDate} from "../lib/record-workspace.mjs";
const today="2026-10-27";
const rows=[
 {id:"b",title:"Review training",module_id:"training",owner_name:"People",due_date:"2026-11-01",status:"OPEN"},
 {id:"a",title:"Supplier certificate",module_id:"suppliers",owner_name:"Quality",due_date:"2026-10-20",status:"OPEN"},
 {id:"c",title:"Completed audit",module_id:"audits",owner_name:"Quality",due_date:"2026-10-10",status:"COMPLETE"},
 {id:"d",title:"No date",module_id:"suppliers",owner_name:"Quality",due_date:null,status:"OPEN"}
];
test("overdue records sort first and completed last",()=>assert.deepEqual(sortRecords(rows,today).map(r=>r.id),["a","b","d","c"]));
test("search and module filters combine",()=>assert.deepEqual(filterRecords(rows,{module:"suppliers",query:"certificate",urgency:"all",today}).map(r=>r.id),["a"]));
test("completed actions never show overdue",()=>assert.equal(recordUrgency(rows[2],today),"complete"));
test("invalid dates cannot produce fake deadlines",()=>{assert.equal(parseDate("2026-02-30"),null);assert.equal(recordUrgency({...rows[0],due_date:"invalid"},today),"undated");});
