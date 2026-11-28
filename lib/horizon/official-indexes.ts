import {createHash} from 'node:crypto';
import {SaxesParser} from 'saxes';
import {coverageSample,measureCoverage} from './coverage-sample';
import {instrumentPath,instrumentUrl,instrumentSeries} from './instrument-series';
import {scottishPharmaReason} from './watchlists';
import type {HorizonReport} from './model';

const atom='http://www.w3.org/2005/Atom';
type Index={publisher:string;name:string;url:string;section?:string};
export function officialIndexes(report:HorizonReport):Index[]{
 const gov=['drug-device-alerts','drug-safety-update'].map(section=>({publisher:'mhra',name:section,section,url:'https://www.gov.uk/'+section+'.atom'}));
 const years=[...new Set([report.generatedAt.slice(0,4),report.windowStart.slice(0,4)])];
 return [...gov,...instrumentSeries.flatMap(s=>years.map(year=>({publisher:s.id,name:s.name+' '+year,url:'https://www.legislation.gov.uk/'+s.slug+'/'+year+'/data.feed?sort=published'})))];
}
export function indexEntries(xml:string,index:Index){
 const parser=new SaxesParser({xmlns:true}),references=new Map<string,string>(),titles=new Map<string,string>();
 let depth=0,entry:{id:string;date:string;url:string;title:string}|null=null,field:'id'|'date'|'title'|null=null,offered=0,unrecognised=0;
 parser.on('doctype',()=>{throw Error('Unexpected document type');});
 parser.on('opentag',tag=>{
  depth++;
  if(depth===1&&(tag.local!=='feed'||tag.uri!==atom))throw Error('Unexpected index format');
  if(tag.uri!==atom)return;
  if(depth===2&&tag.local==='entry'){entry={id:'',date:'',url:'',title:''};offered++;}
  if(entry&&depth===3){
   if(tag.local==='id')field='id';
   if(tag.local==='title')field='title';
   if(tag.local===(index.section?'updated':'published'))field='date';
   if(tag.local==='link'&&(tag.attributes.rel?.value??'alternate')==='alternate')entry.url=tag.attributes.href?.value??'';
  }
 });
 const content=(value:string)=>{if(field&&entry&&depth>=3)entry[field]+=value;};
 parser.on('text',content);parser.on('cdata',content);
 parser.on('closetag',tag=>{
  if(depth===3)field=null;
  if(depth===2&&entry&&tag.uri===atom&&tag.local==='entry'){
   const path=index.section?null:instrumentPath(entry.id.trim(),index.publisher);
   const url=index.section&&entry.url.startsWith('https://www.gov.uk/'+index.section+'/')?entry.url:path?instrumentUrl(path,index.publisher):null;
   if(url&&Number.isFinite(Date.parse(entry.date))){if(!references.has(url)){references.set(url,new Date(entry.date).toISOString().slice(0,10));titles.set(url,entry.title.replace(/\s+/g,' ').trim().slice(0,240));}}
   else unrecognised++;
   entry=null;
  }
  depth--;
 });
 parser.write(xml).close();
 if(!offered)throw Error('The index returned no entries');
 return {offered,unrecognised,references,titles};
}
export async function readOfficialIndex(index:Index,fetcher:typeof fetch){
 const response=await fetcher(index.url,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(18000)});
 if(!response.ok||!response.body){await response.body?.cancel();throw Error('Index unavailable');}
 const chunks:Uint8Array[]=[],reader=response.body.getReader();let size=0;
 try{
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2_000_000)throw Error('Index size limit');chunks.push(value);}
 }finally{await reader.cancel().catch(()=>{});}
 const bytes=Buffer.concat(chunks);
 return {...indexEntries(bytes.toString('utf8'),index),sha256:createHash('sha256').update(bytes).digest('hex')};
}
export async function assessOfficialIndexes(report:HorizonReport,fetcher:typeof fetch=fetch,now=Date.now()){
 const method='Select up to 30 distinct records on the first page of each publisher index from fully observed UTC days. Compare MHRA update dates and legislative publication dates with the same RegPilot snapshot.';
 const items=new Map(report.items.map(item=>[item.url,item]));
 const indexes=await Promise.all(officialIndexes(report).map(async index=>{
  try{
   const {references,titles,offered,unrecognised,sha256}=await readOfficialIndex(index,fetcher);
   const eligible=[...references].filter(([,on])=>on>report.windowStart.slice(0,10)&&on<report.generatedAt.slice(0,10));
   const entries=eligible.slice(0,30).map(([url,on])=>({url,on}));
   const result=entries.length?measureCoverage(coverageSample.parse({publisher:index.publisher,title:index.name,method,entries}),report,now):null;
   const found=result?.rows.filter(r=>r.outcome==='FOUND')??[];
   const inScottishReview=found.filter(r=>scottishPharmaReason(items.get(r.url)!)).length;
   return {index:index.url,name:index.name,publisher:index.publisher,state:'READ' as const,sha256,offered,
    unrecognised,eligible:eligible.length,selected:entries.length,inScottishReview,result:result?{...result,rows:result.rows.map(row=>({...row,title:titles.get(row.url)||row.url}))}:null};
  }catch{return {index:index.url,name:index.name,publisher:index.publisher,state:'UNAVAILABLE' as const};}
 }));
 const read=indexes.filter(i=>i.state==='READ');
 const coverage={expected:indexes.length,available:read.length,sampled:read.reduce((n,i)=>n+i.selected,0),
  unrecognised:read.reduce((n,i)=>n+i.unrecognised,0),withoutSample:read.filter(i=>!i.selected).length};
 return {coverage,method,verifiedAt:new Date(now).toISOString(),snapshot:report.generatedAt,revision:report.codeCommit,runId:report.runId,indexes};
}
