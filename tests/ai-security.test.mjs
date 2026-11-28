import test from "node:test";import assert from "node:assert/strict";
import {allowedEmail,extractGovBody} from "../lib/ai/security.mjs";
test("AI pilot invite list has no wildcard bypass",()=>{
 assert.equal(allowedEmail(" Invited@Example.com ","other@example.com,invited@example.com"),true);
 assert.equal(allowedEmail("unknown@example.com","*"),false);
 assert.equal(allowedEmail("unknown@example.com",""),false);
});
test("official source parsing drops script markup and ignores non-content metadata",()=>{
 const txt=extractGovBody({details:{body:"<h1>Safety notice</h1><p>Review the current guidance text from the official publication and investigate the source details thoroughly.</p><script>steal()</script>"},secret:"never-include"});
 assert.ok(txt.includes("Review the current guidance"));assert.ok(!txt.includes("steal()"));assert.ok(!txt.includes("never-include"));
});
