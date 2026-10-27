import test from "node:test";
import assert from "node:assert/strict";
import {addDocumentEvent,validDocumentEvents} from "../lib/document-activity.mjs";
test("records document activity with time and details",()=>{const a=addDocumentEvent([],"doc-1","created","Draft","2026-10-27T10:00:00Z");assert.equal(a.length,1);assert.equal(a[0].documentId,"doc-1");assert.equal(validDocumentEvents(a),true)});
test("caps activity history and rejects malformed input",()=>{let a=[];for(let i=0;i<510;i++)a=addDocumentEvent(a,"doc-1","changed");assert.equal(a.length,500);assert.equal(validDocumentEvents([{id:"x"}]),false)});
