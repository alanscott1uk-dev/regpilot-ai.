import {SaxesParser} from 'saxes';
import {CollectionError} from '../connectors/collection-error';
import {resilientGet} from '../connectors/resilient-http';
import {instrumentSeries,isInstrumentSeries,instrumentPath} from './instrument-series';

const host='https://www.legislation.gov.uk',atom='http://www.w3.org/2005/Atom',leg='http://www.legislation.gov.uk/namespaces/legislation';
const dayFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'});
type Row={link:string;title:string;description:string;public_timestamp:string;content_store_document_type:string;organisations:{slug:string}[]};
const bad=()=>new CollectionError('INVALID_LEGISLATION_INDEX');
export function parseInstrumentPage(xml:string,day:string,page:number){
 const parser=new SaxesParser({xmlns:true}),rows:Row[]=[];
 let depth=0,index='',pageText='',next=false,entries=0,key='',value='',selfPage=false,rootSeen=false;
 let entry:{id:string;title:string;published:string}|null=null;
 const text=(v:string)=>{if(key)value+=v;};
 parser.on('doctype',()=>{throw bad();});
 parser.on('opentag',t=>{
  if(++depth>40)throw bad();
  if(depth===1){if(t.uri!==atom||t.local!=='feed')throw bad();rootSeen=true;}
  if(depth===2&&t.uri===atom&&t.local==='entry'){entry={id:'',title:'',published:''};entries++;}
  if(depth===2&&t.uri===atom&&t.local==='link'&&t.attributes.rel?.value==='next'){
   const href=new URL(t.attributes.href?.value||'');
   if(!['http:','https:'].includes(href.protocol)||href.host!=='www.legislation.gov.uk'||href.username||href.password||!['/new/'+day,'/new/'+day+'/data.feed'].includes(href.pathname)||href.searchParams.get('page')!==String(page+1))throw bad();next=true;
  }
  if(depth===2&&t.uri===leg&&t.local==='page'){selfPage=true;key='page';value='';}
  if(depth===2&&t.uri===atom&&t.local==='id'){key='index';value='';}
  if(depth===3&&entry&&t.uri===atom&&['id','title','published'].includes(t.local)){key=t.local;value='';}
 });
 parser.on('text',text);parser.on('cdata',text);
 parser.on('closetag',t=>{
  if(depth===2&&key==='index'&&t.local==='id'){index=value.trim();key='';}
  if(depth===2&&key==='page'&&t.local==='page'){pageText=value.trim();key='';}
  if(depth===3&&entry&&key===t.local){entry[key as keyof typeof entry]=value.replace(/\s+/g,' ').trim();key='';}
  if(depth===2&&entry&&t.uri===atom&&t.local==='entry'){
   const identity=URL.canParse(entry.id)?new URL(entry.id):null;
   if(!identity||identity.hostname!=='www.legislation.gov.uk'||!['http:','https:'].includes(identity.protocol)||identity.port||identity.username||identity.password)throw bad();
   const code=identity.pathname.split('/')[identity.pathname.startsWith('/id/')?2:1];
   if(!code)throw bad();
   if(isInstrumentSeries(code)){
    const link=instrumentPath(entry.id,code),date=Date.parse(entry.published);
    if(!link||!entry.title||!Number.isFinite(date)||dayFormat.format(date)!==day)throw bad();
    const [,,series,year,number,correction]=link.split('/'),label=instrumentSeries.find(s=>s.id===series)!.name;
    rows.push({link,title:correction?label+' '+year+'/'+number+' · '+entry.title:entry.title,description:label+' · '+year+'/'+number,public_timestamp:new Date(date).toISOString(),content_store_document_type:correction?'statutory_correction_slip':'statutory_instrument',organisations:[{slug:code}]});
   }
   entry=null;
  }
  depth--;
 });
 parser.write(xml).close();
 if(!rootSeen||index.replace(/^http:/,'https:')!==host+'/new/'+day||!selfPage||pageText!==String(page)||entries>100||next&&!entries)throw bad();
 return {rows,next};
}
async function readDay(day:string,read:(url:string)=>Promise<Response>){
 const rows:Row[]=[],seen=new Set<string>();
 for(let page=1;page<=12;page++){
  const url=host+'/new/'+day+'/data.feed'+(page===1?'':'?page='+page),res=await read(url);
  if(!res.ok||!res.body||res.url&&res.url!==url){await res.body?.cancel();throw bad();}
  const reader=res.body.getReader(),chunks:Uint8Array[]=[];let bytes=0;
  try{for(;;){const chunk=await reader.read();if(chunk.done)break;if((bytes+=chunk.value.length)>1_500_000)throw bad();chunks.push(chunk.value);}}
  finally{await reader.cancel().catch(()=>{});}
  const result=parseInstrumentPage(Buffer.concat(chunks).toString('utf8'),day,page);
  for(const row of result.rows){if(seen.has(row.link))throw bad();seen.add(row.link);rows.push(row);}
  if(!result.next)return rows;
 }
 throw new CollectionError('RESULT_LIMIT');
}
export async function instrumentWindow(start:string,end:string,fetcher:typeof fetch,metrics:{requests:number;retries:number}){
 const first=Date.parse(dayFormat.format(new Date(start))+'T00:00:00Z'),last=Date.parse(dayFormat.format(new Date(end))+'T00:00:00Z');
 const days=Array.from({length:Math.round((last-first)/86400000)+1},(_,i)=>new Date(last-i*86400000).toISOString().slice(0,10));
 if(days.length>32)throw bad();
 const read=resilientGet(fetcher,host,{accept:'application/atom+xml'},{timeoutMs:55000,maxRequests:64,metrics});
 const observations=new Map<string,Row[]>(),failed:string[]=[];let offset=0;
 async function worker(){while(offset<days.length){const day=days[offset++];try{observations.set(day,await readDay(day,read));}catch{failed.push(day);}}}
 await Promise.all(Array.from({length:3},worker));
 const unique=new Map<string,Row>();let duplicate=false;
 for(const day of days)for(const row of observations.get(day)??[]){if(unique.has(row.link)){duplicate=true;continue;}if(Date.parse(row.public_timestamp)<=Date.parse(end))unique.set(row.link,row);}
 return {rows:[...unique.values()],limited:failed.length>0||duplicate,unavailable:!observations.size};
}
