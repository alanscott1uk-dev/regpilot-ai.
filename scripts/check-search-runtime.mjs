// Exercise the search model using only the files packaged for each Next.js route.
import assert from 'node:assert/strict';
import {copyFile,mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const modelDir=path.resolve('node_modules/@yarflam/potion-base-8m');
async function tracedModelFiles(route){
 const trace=path.resolve('.next/server/app/api',route,'route.js.nft.json');
 const {files}=JSON.parse(await readFile(trace,'utf8'));
 return files.map(file=>path.resolve(path.dirname(trace),file)).filter(file=>file.startsWith(modelDir+path.sep));
}
for(const route of ['workspace/knowledge','workspace/knowledge/index','workspace/knowledge/search']){
 const files=await tracedModelFiles(route);
 assert.ok(!files.some(file=>file.endsWith('/model.safetensors')),route+' unexpectedly ships the public search weights');
}
for(const route of ['ai/research','ai/analyse','workspace/knowledge/research']){
 const isolated=await mkdtemp(path.join(tmpdir(),'regpilot-search-'));
 try{
  for(const src of await tracedModelFiles(route)){
   const dest=path.join(isolated,path.relative(modelDir,src));
   await mkdir(path.dirname(dest),{recursive:true});await copyFile(src,dest);
  }
  const {embed,cosineSimilarity}=await import(pathToFileURL(path.join(isolated,'index.js')).href);
  const [query,same,other]=await embed(['Payroll supplier access','Payroll supplier access','Fire extinguisher servicing']);
  assert.ok(query.length>0&&query.every(Number.isFinite));
  assert.ok(cosineSimilarity(query,same)>cosineSimilarity(query,other),route+' failed isolated search inference');
 }finally{await rm(isolated,{recursive:true,force:true});}
}
console.log('Search production-package check PASS: three routes run isolated model inference and three document routes exclude the model weights.');
