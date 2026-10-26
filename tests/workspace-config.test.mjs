import test from "node:test";
import assert from "node:assert/strict";
import {defaultWorkspace,parseWorkspace,moduleHref} from "../lib/workspace-config.mjs";
test("workspace default is valid",()=>assert.deepEqual(parseWorkspace(defaultWorkspace()),defaultWorkspace()));
test("malformed workspace rejected",()=>{assert.equal(parseWorkspace(null),null);assert.equal(parseWorkspace({company:"",industry:"general",departments:["HR","hr"],modules:[]}),null)});
test("module routing only exposes implemented routes",()=>{assert.equal(moduleHref("imports"),"/distribution");assert.equal(moduleHref("risk"),null);assert.equal(moduleHref("regulatory"),"/regulatory-sources")});
