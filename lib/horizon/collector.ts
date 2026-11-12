import {resilientGet} from '../connectors/resilient-http';
import {createHash} from 'node:crypto';
import {PUBLISHERS,MAX_PUBLISHER_RESULTS,MAX_RETAINED_ITEMS,MAX_REPORT_BYTES,horizonPath,validateReport,type HorizonItem,type HorizonReport} from './model';
const digest=(s:string)=>createHash('sha256').update(s).digest('hex').slice(0,32);
const plain=(v:unknown,max:number)=>typeof v==='string'?v.replace(/<[^>]*>/g,' ').replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max):'';
export function itemKind(path:string,type:string):HorizonItem['kind']{
 if(path.startsWith('/drug-device-alerts/')||type==='medical_safety_alert'||type==='product_safety_alert_report')return 'Safety alert';
 if(type.includes('consultation'))return 'Consultation';
 if(/regulation|decision|statutory|notice/.test(type))return 'Regulation or decision';
 if(/guidance|guide|manual/.test(type))return 'Guidance';
 if(/policy/.test(type))return 'Policy';
 if(/news|press_release|speech/.test(type))return 'News';return 'Other publication';
}
export async function boundedJson(url:string,fetcher:typeof fetch=fetch,max=2_000_000,cache:RequestCache='no-store'){
 const response=await fetcher(url,{method:'GET',headers:{accept:'application/json'},redirect:'error',cache,signal:AbortSignal.timeout(10000)});
 if(!response.ok||response.url&&response.url!==url){await response.body?.cancel();throw Error('PUBLIC_SERVICE_UNAVAILABLE');}
 const reader=response.body?.getReader();if(!reader)throw Error('EMPTY_RESPONSE');let size=0;const chunks:Uint8Array[]=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max)throw Error('RESPONSE_TOO_LARGE');chunks.push(value);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}finally{await reader.cancel().catch(()=>{});}
}
export async function collectHorizon(previous:unknown,fetcher:typeof fetch=fetch,now=new Date(),provenance:{codeCommit:string|null;runId:string|null}={codeCommit:null,runId:null}):Promise<HorizonReport>{
 const started=Date.now(),metrics={requests:0,retries:0};
 const generatedAt=now.toISOString(),windowStart=new Date(now.getTime()-30*86400000).toISOString();let old:HorizonReport|null=null;
 try{old=validateReport(previous,now.getTime());}catch{}
 const prior=new Map((old?.items||[]).filter(i=>Date.parse(i.updatedAt)>=Date.parse(windowStart)).map(i=>[i.id,i]));
 const collected=new Map<string,HorizonItem>(),feeds:HorizonReport['feeds']=new Array(PUBLISHERS.length);let cursor=0;
 async function worker(){while(cursor<PUBLISHERS.length){const index=cursor++,publisher=PUBLISHERS[index];let total:number|null=null,retrieved=0,indexChanged=false;const staged:HorizonItem[]=[];const seen=new Set<string>();
  const feedMetrics={requests:0,retries:0};
  const retryRead=resilientGet(fetcher,'https://www.gov.uk',{accept:'application/json'},{timeoutMs:90000,maxRequests:60,metrics:feedMetrics});
  try{for(let page=0;page<MAX_PUBLISHER_RESULTS/50;page++){
   const params=new URLSearchParams({filter_organisations:publisher.slug,filter_public_timestamp:'from:'+windowStart.slice(0,10)+',to:'+generatedAt,order:'-public_timestamp',count:'50',start:String(page*50),fields:'title,link,description,public_timestamp,content_store_document_type,organisations'});
   const raw=await boundedJson('https://www.gov.uk/api/search.json?'+params,(url)=>retryRead(String(url)));
   if(!Array.isArray(raw?.results)||raw.results.length>50||!Number.isSafeInteger(raw.total)||raw.total<0)throw Error('INVALID_RESPONSE');if(total!==null&&total!==raw.total)indexChanged=true;total=raw.total;
   for(const row of raw.results){
    const path=horizonPath.parse(row.link),updatedAt=typeof row.public_timestamp==='string'?new Date(row.public_timestamp).toISOString():'';
    if(!updatedAt||Date.parse(updatedAt)>now.getTime()+300000||!Array.isArray(row.organisations)||!row.organisations.some((o:any)=>o?.slug===publisher.slug))throw Error('UNVERIFIED_PUBLISHER');
    if(seen.has(path))throw Error('DUPLICATE_PAGE');seen.add(path);retrieved++;
    if(Date.parse(updatedAt)<Date.parse(windowStart))continue;
    const url='https://www.gov.uk'+path,title=plain(row.title,240),summary=plain(row.description,360),documentType=plain(row.content_store_document_type,100);
    if(!title||!documentType)throw Error('INVALID_RESPONSE');
    const id=digest(url),revision=digest(JSON.stringify({title,summary,documentType,updatedAt})),before=prior.get(id);
    staged.push({id,revision,path,url,title,summary,documentType,kind:itemKind(path,documentType),publisherIds:[publisher.id],updatedAt,firstSeenAt:before?.firstSeenAt||generatedAt,observedAt:generatedAt,discovery:!old?'BASELINE':!before?'FIRST_SEEN':before.revision!==revision?'METADATA_UPDATED':'UNCHANGED'});
   }
   if(raw.results.length<50||retrieved>=total!)break;
  }
  for(const item of staged)if(collected.has(item.id)&&collected.get(item.id)!.revision!==item.revision)throw Error('INCONSISTENT_PUBLICATION');
  for(const item of staged){const existing=collected.get(item.id);if(existing){existing.publisherIds=[...new Set([...existing.publisherIds,publisher.id])];}else collected.set(item.id,item);}
  feeds[index]={id:publisher.id,state:total!>retrieved||indexChanged?'limited':'available',checkedAt:generatedAt,total,retrieved,reason:indexChanged?'INDEX_CHANGED':total!>retrieved?'RESULT_LIMIT':null};
  }catch{feeds[index]={id:publisher.id,state:'unavailable',checkedAt:generatedAt,total,retrieved:0,reason:'FETCH_OR_IDENTITY_FAILED'};}finally{metrics.requests+=feedMetrics.requests;metrics.retries+=feedMetrics.retries;}
 }}
 await Promise.all(Array.from({length:3},()=>worker()));
 // Earlier metadata is retained through outages, with its old observation time.
 for(const [id,item] of prior)if(!collected.has(id))collected.set(id,item);
 const sorted=[...collected.values()].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id));
 // Keep the complete JSON response below the hosting response limit, including UTF-8 titles.
 const items:HorizonItem[]=[];let retainedBytes=20000;
 for(const item of sorted){const bytes=Buffer.byteLength(JSON.stringify(item),'utf8')+1;if(items.length>=MAX_RETAINED_ITEMS||retainedBytes+bytes>MAX_REPORT_BYTES)break;items.push(item);retainedBytes+=bytes;}
 const summarize=(r:HorizonReport)=>({generatedAt:r.generatedAt,runId:r.runId,publications:r.items.length,available:r.feeds.filter(f=>f.state==='available').length,limited:r.feeds.filter(f=>f.state==='limited').length,unavailable:r.feeds.filter(f=>f.state==='unavailable').length});
 const previousHistory=old?[summarize(old),...(old.pipeline?.history||[])]:[];
 const history=[...new Map(previousHistory.filter(h=>h.generatedAt!==generatedAt).map(h=>[h.generatedAt,h])).values()].sort((a,b)=>b.generatedAt.localeCompare(a.generatedAt)).slice(0,48);
 return validateReport({pipeline:{cadenceMinutes:60,durationMs:Date.now()-started,...metrics,retentionLimited:collected.size>items.length,history},format:'regpilot-horizon-v1',generatedAt,windowStart,...provenance,previousAvailable:!!old,feeds,items,limitations:[
  'Discovery metadata from selected GOV.UK publishers over the last 30 days. This is not complete UK regulatory coverage.',
  'Each publisher is bounded to 2,000 results per run and the retained feed to 10,000 records or 4 MB, whichever is reached first. Limits and unavailable feeds are explicit; older items keep their original observation time.',
  'Publication timestamps and metadata changes are not legal effective dates or proof of changed obligations. Applicability and jurisdiction require review.',
  'Publisher/activity matching and category priority are transparent sorting aids, not legal assessments. Full text, linked attachments and independently reviewed requirements are handled separately.',
  'Public metadata is attributed to GOV.UK. Contains public sector information licensed under the Open Government Licence v3.0.'
 ]},now.getTime());
}
