import {CollectionError} from '../connectors/collection-error';
import {readBoundedJson} from '../connectors/bounded-http';

export async function fdaSearchPage(windowStart:string,generatedAt:string,offset:number,read:(url:string)=>Promise<Response>){
 const stamp=(v:string)=>v.slice(0,10).replaceAll('-','');
 const count=100,params=new URLSearchParams({search:'report_date:['+stamp(windowStart)+' TO '+stamp(generatedAt)+']',sort:'report_date:desc',limit:String(count),skip:String(offset)});
 const url='https://api.fda.gov/drug/enforcement.json?'+params;
 const response=await read(url);
 if(response.url&&response.url!==url){await response.body?.cancel();throw new CollectionError('TARGET_MISMATCH');}
 if(!response.ok&&response.status!==404){await response.body?.cancel();throw new CollectionError('HTTP_STATUS_'+response.status);}
 const data=await readBoundedJson(response,2_000_000);
 if(response.status===404){
  if(offset===0&&data?.error?.code==='NOT_FOUND'&&data.error.message==='No matches found!')return {count,raw:{total:0,results:[]}};
  throw new CollectionError('HTTP_STATUS_404');
 }
 const meta=data?.meta?.results;
 if(!Number.isSafeInteger(meta?.total)||meta.total<0||meta.skip!==offset||!Array.isArray(data.results)||data.results.length>count)throw new CollectionError('INVALID_RESPONSE_SHAPE');
 const results=data.results.map((r:Record<string,unknown>)=>{
  if(typeof r.recall_number!=='string'||!/^D-\d{1,6}-\d{4}$/.test(r.recall_number)||typeof r.report_date!=='string'||!/^\d{8}$/.test(r.report_date)||typeof r.product_description!=='string'||!r.product_description.trim()||typeof r.reason_for_recall!=='string'||typeof r.status!=='string'||r.product_type!=='Drugs')throw new CollectionError('INVALID_PUBLICATION_METADATA');
  const day=r.report_date.slice(0,4)+'-'+r.report_date.slice(4,6)+'-'+r.report_date.slice(6);
  if(!Number.isFinite(Date.parse(day))||new Date(day).toISOString().slice(0,10)!==day||r.report_date<stamp(windowStart)||r.report_date>stamp(generatedAt))throw new CollectionError('INVALID_PUBLICATION_TIMESTAMP');
  return {title:r.recall_number+' · '+r.product_description,description:r.status+' · '+r.reason_for_recall,link:'/us-fda/drug-recalls/'+r.recall_number.toLowerCase(),public_timestamp:day+'T00:00:00Z',content_store_document_type:'drug_recall',organisations:[{slug:'us-fda'}]};
 });
 return {count,raw:{total:meta.total as number,results}};
}
