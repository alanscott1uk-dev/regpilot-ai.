import {readFile,copyFile,mkdir,mkdtemp,rm} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {Worker} from "node:worker_threads";
import assert from "node:assert/strict";
import {fixtureDocx} from "../tests/helpers/docx-fixture.mjs";
const root=process.cwd(),routes=["api/workspace/services","api/workspace/evidence","api/workspace/evidence/[id]/inspect","api/workspace/programme","api/workspace/assurance","api/workspace/assurance/[id]","api/workspace/library/coverage","api/workspace/library/coverage/[id]","api/ai/analyse"];
// Verify every consuming route independently, so one trace cannot hide another's missing dependency.
for(const route of routes){
  const tracePath=path.join(root,".next/server/app",route,"route.js.nft.json"),trace=JSON.parse(await readFile(tracePath,"utf8"));
  const files=trace.files.map(p=>path.resolve(path.dirname(tracePath),p)).filter(p=>/lib\/server\/docx-(?:extraction-worker|parser)\.mjs|node_modules\/(?:yauzl|pend|saxes|xmlchars)\//.test(p));
  for(const required of ["lib/server/docx-extraction-worker.mjs","lib/server/docx-parser.mjs","node_modules/yauzl/index.js","node_modules/saxes/saxes.js"])assert.ok(files.some(p=>p.endsWith(required)),route+" is missing "+required);
  const isolated=await mkdtemp(path.join(os.tmpdir(),"regpilot-docx-runtime-"));
  try{
    for(const file of files){const relative=path.relative(root,file);assert.ok(!relative.startsWith(".."));const target=path.join(isolated,relative);await mkdir(path.dirname(target),{recursive:true});await copyFile(file,target);}
    await new Promise((resolve,reject)=>{
      const worker=new Worker(path.join(isolated,"lib/server/docx-extraction-worker.mjs"),{workerData:fixtureDocx(),execArgv:[],env:{},stdout:true,stderr:true});
      worker.stdout.resume();worker.stderr.resume();let done=false;
      const finish=error=>{if(done)return;done=true;clearTimeout(timer);void worker.terminate();error?reject(error):resolve();};
      const timer=setTimeout(()=>finish(Error("Packaged Word worker timed out")),10000);
      worker.once("message",message=>{try{assert.equal(message.ok,true);assert.equal(message.document.unitKind,"block");assert.match(message.document.pages[0].text,/Fictional staff must/);finish();}catch(e){finish(e);}});
      worker.once("error",finish);worker.once("exit",()=>{if(!done)finish(Error("Packaged Word worker exited without text"));});
    });
  }finally{await rm(isolated,{recursive:true,force:true});}
}
console.log(`Word production-package check PASS: ${routes.length} independent route traces and real isolated extractions.`);
