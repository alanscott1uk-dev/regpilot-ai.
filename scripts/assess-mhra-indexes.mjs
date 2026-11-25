import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {SaxesParser} from 'saxes';
import * as model from '../lib/horizon/model.ts';
import * as coverage from '../lib/horizon/coverage-sample.ts';

const {validateReport}=model.default??model;
const {measureCoverage,coverageSample}=coverage.default??coverage;
const atom='http://www.w3.org/2005/Atom';
const report=validateReport(JSON.parse(await readFile(process.argv[2]??'artifacts/horizon.json','utf8')));
const method='Use the first 30 distinct URLs in each official MHRA Atom index whose update dates fall within fully observed UTC days of the same snapshot.';

async function assess(index){
 const url='https://www.gov.uk/'+index+'.atom';
 const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!response.ok||!response.body)throw Error('Index unavailable');
 const sha=createHash('sha256'),chunks=[];
 let size=0;
 for await(const chunk of response.body){
  size+=chunk.length;
  if(size>2_000_000)throw Error('Index exceeds size limit');
  sha.update(chunk);chunks.push(chunk);
 }
 const parser=new SaxesParser({xmlns:true}),references=new Map();
 let depth=0,record=null,readingDate=false,seenEntries=0;
 parser.on('doctype',()=>{throw Error('Unexpected document type');});
 parser.on('opentag',tag=>{
  depth++;
  if(depth===1&&(tag.local!=='feed'||tag.uri!==atom))throw Error('Unexpected index format');
  if(tag.uri!==atom)return;
  if(depth===2&&tag.local==='entry'){record={on:'',url:''};seenEntries++;}
  if(record&&depth===3){
   if(tag.local==='updated')readingDate=true;
   if(tag.local==='link'&&(tag.attributes.rel?.value??'alternate')==='alternate')record.url=tag.attributes.href?.value??'';
  }
 });
 parser.on('text',value=>{if(readingDate)record.on+=value;});
 parser.on('closetag',tag=>{
  if(depth===3&&tag.uri===atom&&tag.local==='updated')readingDate=false;
  if(record&&depth===2&&tag.uri===atom&&tag.local==='entry'){
   if(!record.url.startsWith('https://www.gov.uk/'+index+'/')||!Number.isFinite(Date.parse(record.on)))throw Error('Index record identity unavailable');
   const on=new Date(record.on).toISOString().slice(0,10);
   if(on>report.windowStart.slice(0,10)&&on<report.generatedAt.slice(0,10)&&!references.has(record.url))references.set(record.url,{url:record.url,on});
   record=null;
  }
  depth--;
 });
 parser.write(Buffer.concat(chunks).toString('utf8')).close();
 if(!seenEntries)throw Error('Index had no entries');
 const entries=[...references.values()].slice(0,30);
 const result=entries.length?measureCoverage(coverageSample.parse({publisher:'mhra',title:index,method,entries}),report):null;
 return {index:url,state:'READ',sha256:sha.digest('hex'),offered:seenEntries,eligible:references.size,selected:entries.length,result};
}

const indexes=await Promise.all(['drug-device-alerts','drug-safety-update'].map(async index=>{
 try{return await assess(index);}catch{return {index:'https://www.gov.uk/'+index+'.atom',state:'UNAVAILABLE'};}
}));
const result={method,verifiedAt:new Date().toISOString(),snapshot:report.generatedAt,revision:report.codeCommit,runId:report.runId,indexes};
await writeFile(process.argv[3]??'artifacts/mhra-index-coverage.json',JSON.stringify(result,null,2)+'\n');
for(const index of indexes)console.log(index.index,index.state,index.result?JSON.stringify({found:index.result.found,missing:index.result.missing,wrongPublisher:index.result.wrongPublisher,indeterminate:index.result.indeterminate}):'No measurable reference set');
if(indexes.every(i=>i.state==='UNAVAILABLE'))process.exitCode=1;
