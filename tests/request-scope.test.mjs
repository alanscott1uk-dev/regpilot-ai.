import test from "node:test";
import assert from "node:assert/strict";
import {createRequestScope} from "../lib/client/request-scope.mjs";

test("organisation changes abort outstanding work and reject the old response",()=>{
 const scope=createRequestScope("org-a"),a=scope.capture();
 assert.equal(scope.current(a),true);
 scope.invalidate("org-b");
 assert.equal(a.signal.aborted,true);assert.equal(scope.current(a),false);
 assert.equal(scope.current(scope.capture()),true);
});
test("returning to the same organisation never revives an earlier request",()=>{
 const scope=createRequestScope("org-a"),old=scope.capture();
 scope.invalidate("org-b");scope.invalidate("org-a");
 assert.equal(scope.current(old),false);assert.equal(scope.capture().scope,"org-a");
});
test("logout, same-org account replacement and unmount invalidate all captured tickets",()=>{
 const scope=createRequestScope("org-a"),before=scope.capture();
 scope.invalidate();assert.equal(scope.current(before),false);assert.equal(scope.capture().scope,"");
 scope.invalidate("org-a");const next=scope.capture();scope.invalidate("org-a");
 assert.equal(scope.current(next),false);assert.equal(next.signal.aborted,true);
 scope.invalidate();assert.equal(scope.current(null),false);
});
test("a slow mutation cannot display old-organisation records after a switch",async()=>{
 const scope=createRequestScope("org-a"),ticket=scope.capture();
 let resolve;const response=new Promise(r=>{resolve=r;});let displayed=null;
 const pending=response.then(value=>{if(scope.current(ticket))displayed=value;});
 scope.invalidate("org-b");resolve({organisation:"org-a",privateRecord:"fixture-only"});
 await pending;assert.equal(displayed,null);
});
