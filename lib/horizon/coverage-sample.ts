import {z} from 'zod';
import {horizonPath,horizonSourceUrl,PUBLISHERS,reportState,type HorizonReport} from './model';

const publisher=z.string().refine(s=>PUBLISHERS.some(p=>p.id===s));
const entry=z.object({on:z.iso.date(),url:z.url().max(700)}).strict();
function official(url:string,publisher:string){
 if(!URL.canParse(url))return false;
 const parsed=new URL(url);
 if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.hash)return false;
 if(publisher!=='us-fda')return parsed.origin==='https://www.gov.uk'&&!parsed.search&&horizonPath.safeParse(parsed.pathname).success&&!parsed.pathname.startsWith('/us-fda/')&&url===parsed.origin+parsed.pathname;
 if(parsed.origin!=='https://api.fda.gov'||parsed.pathname!=='/drug/enforcement.json'||parsed.searchParams.size!==1)return false;
 const query=parsed.searchParams.get('search')??'',number=/^recall_number:"(D-\d{1,6}-\d{4})"$/.exec(query)?.[1],event=/^event_id:([1-9]\d{0,11})$/.exec(query)?.[1];
 return !!(number||event);
}
export const coverageSample=z.object({publisher,title:z.string().trim().min(5).max(120),method:z.string().trim().min(20).max(500),entries:z.array(entry).min(1).max(30)}).strict().superRefine((s,ctx)=>{
 const seen=new Set<string>();
 for(const e of s.entries){
  if(!official(e.url,s.publisher)){ctx.addIssue({code:'custom',message:'Use the official publisher record URL.'});continue;}
  const key=canonical(e.url,s.publisher);
  if(seen.has(key))ctx.addIssue({code:'custom',message:'Each publication can be sampled once.'});seen.add(key);
 }
});
export type CoverageSample=z.infer<typeof coverageSample>;
function canonical(url:string,publisher:string){
 if(publisher!=='us-fda')return url;
 const query=new URL(url).searchParams.get('search')!;
 return query.startsWith('event_id:')?horizonSourceUrl('/us-fda/drug-events/'+query.slice(9),[publisher]):horizonSourceUrl('/us-fda/drug-recalls/'+query.slice('recall_number:"'.length,-1).toLowerCase(),[publisher]);
}
export function measureCoverage(sample:CoverageSample,report:HorizonReport,now=Date.now()){
 const feed=report.feeds.find(f=>f.id===sample.publisher),index=new Map(report.items.map(row=>[row.url,row]));
 const rows=sample.entries.map(e=>{
  const url=canonical(e.url,sample.publisher),item=index.get(url);
  const fullDay=e.on>report.windowStart.slice(0,10)&&e.on<report.generatedAt.slice(0,10);
  let outcome:'FOUND'|'WRONG_PUBLISHER'|'MISSING'|'INDETERMINATE',reason='';
  if(!fullDay||reportState(report,now)==='stale'||!feed||feed.state==='unavailable'){outcome='INDETERMINATE';reason=!fullDay?'Outside the fully observed days':!feed?'Publisher outside snapshot':'Stale or unavailable collection';}
  else if(item&&item.observedAt===report.generatedAt){outcome=item.publisherIds.includes(sample.publisher)?'FOUND':'WRONG_PUBLISHER';}
  else if(item||feed.state==='limited'||report.pipeline?.retentionLimited){outcome='INDETERMINATE';reason=item?'Only an older observation was retained':'Collection or retention limit reached';}
  else outcome='MISSING';
  return {...e,url,outcome,reason,itemId:item?.id??null,revision:item?.revision??null};
 });
 const found=rows.filter(e=>e.outcome==='FOUND').length,wrongPublisher=rows.filter(e=>e.outcome==='WRONG_PUBLISHER').length,missing=rows.filter(e=>e.outcome==='MISSING').length,measurable=found+wrongPublisher+missing;
 return {generatedAt:report.generatedAt,release:report.codeCommit,runId:report.runId,found,wrongPublisher,missing,indeterminate:rows.length-measurable,measurable,rows};
}
