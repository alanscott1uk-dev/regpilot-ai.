import {CollectionError} from '../connectors/collection-error';
import {readBoundedJson} from '../connectors/bounded-http';

export const emaShortageDataset='https://www.ema.europa.eu/en/documents/report/shortages-output-json-report_en.json';
const base='https://www.ema.europa.eu/en/medicines/human/shortages/';
export function emaShortageUrl(path:string){
 const slug=/^\/eu-ema\/shortages\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(path)?.[1];
 if(!slug)throw Error('Invalid EMA shortage record');
 return base+slug;
}
function isoDay(value:unknown){
 const d=typeof value==='string'&&/^(\d\d)\/(\d\d)\/(\d{4})$/.exec(value);
 if(!d)throw new CollectionError('INVALID_PUBLICATION_TIMESTAMP');
 const iso=d[3]+'-'+d[2]+'-'+d[1];
 if(!Number.isFinite(Date.parse(iso))||new Date(iso).toISOString().slice(0,10)!==iso)throw new CollectionError('INVALID_PUBLICATION_TIMESTAMP');
 return iso;
}
export async function emaShortages(start:string,end:string,read:(url:string)=>Promise<Response>){
 const response=await read(emaShortageDataset);
 if(!response.ok||response.url&&response.url!==emaShortageDataset){await response.body?.cancel();throw new CollectionError('PROVIDER_UNAVAILABLE');}
 const body=await readBoundedJson(response,2_000_000);
 if(!Array.isArray(body?.data)||body.meta?.total_records!==body.data.length||body.data.length>10000)throw new CollectionError('INCOMPLETE_PAGE');
 const rows=[],urls=new Set<string>();
 for(const entry of body.data){
  if(entry?.category==='Veterinary')continue;
  if(entry?.category!=='Human'||typeof entry.shortage_url!=='string'||!entry.shortage_url.startsWith(base)||typeof entry.medicine_affected!=='string'||!entry.medicine_affected.trim()||typeof entry.supply_shortage_status!=='string'||!entry.supply_shortage_status.trim())throw new CollectionError('INVALID_PUBLICATION_METADATA');
  const link='/eu-ema/shortages/'+entry.shortage_url.slice(base.length);
  if(emaShortageUrl(link)!==entry.shortage_url||urls.has(link))throw new CollectionError('INVALID_PUBLICATION_PATH');
  urls.add(link);
  const first=isoDay(entry.first_published_date),day=entry.last_updated_date?isoDay(entry.last_updated_date):first;
  if(day<first||day>end.slice(0,10))throw new CollectionError('INVALID_PUBLICATION_TIMESTAMP');
  if(day<start.slice(0,10))continue;
  rows.push({link,title:entry.medicine_affected+' · '+entry.supply_shortage_status,
   description:[entry.international_non_proprietary_name_inn_or_common_name,entry.pharmaceutical_forms_affected,entry.strengths_affected].filter(s=>typeof s==='string'&&s.trim()).join(' · '),
   public_timestamp:day+'T00:00:00Z',content_store_document_type:'medicine_shortage_notice',organisations:[{slug:'eu-ema'}]});
 }
 return rows;
}
