import {readFile,copyFile,mkdir,mkdtemp,rm} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {Worker} from "node:worker_threads";
import assert from "node:assert/strict";
import {fixturePdf} from "../tests/helpers/pdf-fixture.mjs";
// Verify the Next production trace actually contains the dynamic parser worker,
// and execute it from an isolated package made ONLY from traced runtime files.
const root=process.cwd(),files=new Set(),routes=["api/workspace/programme","api/workspace/assurance","api/workspace/assurance/[id]","api/ai/analyse"];
for(const route of routes){
  const tracePath=path.join(root,".next/server/app",route,"route.js.nft.json"),trace=JSON.parse(await readFile(tracePath,"utf8"));
  const relevant=trace.files.map(p=>path.resolve(path.dirname(tracePath),p)).filter(p=>/pdf-extraction-worker\.mjs|node_modules\/pdfjs-dist\/|node_modules\/@napi-rs\/canvas/.test(p));
  assert.ok(relevant.some(p=>p.endsWith("lib/server/pdf-extraction-worker.mjs")),route+" is missing its parser worker");
  assert.ok(relevant.some(p=>p.endsWith("pdfjs-dist/legacy/build/pdf.worker.mjs")),route+" is missing the PDF.js worker");
  for(const file of relevant)files.add(file);
}
const isolated=await mkdtemp(path.join(os.tmpdir(),"regpilot-pdf-runtime-"));
try{
  for(const file of files){const relative=path.relative(root,file);assert.ok(!relative.startsWith(".."));const target=path.join(isolated,relative);await mkdir(path.dirname(target),{recursive:true});await copyFile(file,target);}
  await new Promise((resolve,reject)=>{
    const worker=new Worker(path.join(isolated,"lib/server/pdf-extraction-worker.mjs"),{workerData:fixturePdf([["Fictional isolated deployment trace proof."]]),execArgv:[],env:{},stdout:true,stderr:true});
    worker.stdout.resume();worker.stderr.resume();let done=false;
    const finish=(error)=>{if(done)return;done=true;clearTimeout(timer);void worker.terminate();error?reject(error):resolve();};
    const timer=setTimeout(()=>finish(Error("Packaged PDF worker timed out")),10000);
    worker.once("message",message=>{try{assert.equal(message.ok,true);assert.match(message.document.pages[0].text,/isolated deployment trace proof/);finish();}catch(e){finish(e);}});
    worker.once("error",finish);worker.once("exit",()=>{if(!done)finish(Error("Packaged worker exited without text"));});
  });
  console.log(`PDF production-package check PASS: ${routes.length} route traces, ${files.size} runtime files, real isolated extraction.`);
}finally{await rm(isolated,{recursive:true,force:true});}
