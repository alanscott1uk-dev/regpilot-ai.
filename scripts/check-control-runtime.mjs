import assert from 'node:assert/strict';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {readFile,mkdtemp,mkdir,copyFile,rm} from 'node:fs/promises';

const traceFile=path.resolve('.next/server/app/api/workspace/controls/test/route.js.nft.json');
const files=JSON.parse(await readFile(traceFile,'utf8')).files.map(f=>path.resolve(path.dirname(traceFile),f));
const binary='lib/policies/connected-control.wasm';
const isolated=await mkdtemp(path.join(tmpdir(),'regpilot-control-policy-'));
try{
 for(const source of files){
  const relative=path.relative(process.cwd(),source);
  if(relative!==binary&&!/^node_modules\/(?:@open-policy-agent\/opa-wasm|sprintf-js|yaml)\//.test(relative))continue;
  const destination=path.join(isolated,relative);
  await mkdir(path.dirname(destination),{recursive:true});await copyFile(source,destination);
 }
 const {loadPolicy}=createRequire(path.join(isolated,'check.cjs'))('@open-policy-agent/opa-wasm');
 const policy=await loadPolicy(await readFile(path.join(isolated,binary)));
 const decision=policy.evaluate({observations:[],minimumProviders:1,limited:false},'regpilot/control/decision');
 assert.equal(decision[0].result.state,'INSUFFICIENT_EVIDENCE');
 console.log('Control policy production-package check PASS: isolated OPA evaluation using only endpoint trace files.');
}finally{await rm(isolated,{recursive:true,force:true});}
