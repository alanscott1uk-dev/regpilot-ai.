import {z} from 'zod';
import {CollectionError} from './collection-error';
import type {providerReader} from './bounded-http';
import type {RegisterTarget} from './register-targets';
import type {ConnectorCheck} from './github';

type Reader=ReturnType<typeof providerReader>;
type Check=(id:string,label:string,value:boolean|undefined,observed:string,nextStep:string)=>ConnectorCheck;
const mhra='240f72bd-9a4d-4f39-94d9-77235cadde8e';
const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const day=(v:unknown,now:string)=>typeof v==='string'&&z.iso.date().safeParse(v).success&&v<=now.slice(0,10)?v:undefined;
function publishedDay(value:string,now:string) {
  const m=/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/.exec(value);
  if (!m || !months.includes(m[1])) return undefined;
  return day([m[3],String(months.indexOf(m[1])+1).padStart(2,'0'),m[2].padStart(2,'0')].join('-'),now);
}
export const publicationTargets={
  DAILYMED_LABEL:z.object({scope:z.uuid().toLowerCase(),record:z.string().regex(/^[1-9]\d{0,6}$/)}),
  EUROPE_PMC:z.object({scope:z.string().regex(/^[1-9]\d{0,9}$/),record:z.iso.date(),reference:z.string().max(110).regex(/^10\.\d{4,9}\/[a-z0-9._()/:;-]+$/i).toLowerCase()}),
  MHRA_GUIDANCE:z.object({scope:z.string().min(1).max(145).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),record:z.uuid(),reference:z.iso.datetime({offset:true})})
};

export async function labelHistory(target:RegisterTarget,read:Reader,asOf:string,check:Check) {
  const versions=new Map<number,string>();
  let total:number|undefined;
  let pages=1;
  for(let page=1;page<=pages;page++) {
    const path='https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/'+target.scope+'/history.json?pagesize=100'+(page===1?'':'&page='+page);
    const {body}=(await read(path))!;
    if(body.data?.spl?.setid!==target.scope) throw new CollectionError('TARGET_MISMATCH');
    const parsed=z.object({current_page:z.number().int(),total_pages:z.number().int().min(1).max(12),
      total_elements:z.number().int().positive().max(1200)}).safeParse(body.metadata);
    const history=z.array(z.object({spl_version:z.number().int().positive(),published_date:z.string()})).min(1).max(100).safeParse(body.data.history);
    if(!parsed.success||!history.success||parsed.data.current_page!==page||parsed.data.total_pages!==Math.ceil(parsed.data.total_elements/100)
       ||(total!==undefined&&(total!==parsed.data.total_elements||pages!==parsed.data.total_pages))) throw new CollectionError('INVALID_RESPONSE');
    total=parsed.data.total_elements; pages=parsed.data.total_pages;
    for(const row of history.data){
      if(versions.has(row.spl_version)) throw new CollectionError('INVALID_RESPONSE');
      versions.set(row.spl_version,row.published_date);
    }
  }
  if(versions.size!==total) throw new CollectionError('INVALID_RESPONSE');
  const latest=Math.max(...versions.keys()),reviewed=Number(target.record);
  const ordered=[...versions.entries()].sort(([a],[b])=>a-b).map(([,v])=>publishedDay(v,asOf));
  const chronological=ordered.every(v=>v!==undefined)?ordered.every((v,i)=>i===0||v!>=ordered[i-1]!):undefined;
  return {sourceUrl:'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid='+target.scope,checks:[
    check('label-reviewed','Reviewed label version appears in publisher history',versions.has(reviewed),'Reviewed version '+reviewed,'Confirm the reviewed label set and version.'),
    check('label-current','Reviewed label matches the latest published version',reviewed===latest,'Reviewed '+reviewed+' · published '+latest,'Assess the latest label through document change control.'),
    check('label-chronology','Published version dates form a valid chronology',chronological,versions.size+' versions · latest '+(ordered.at(-1)??'unconfirmed'),'Check the publisher history before relying on its dates.')
  ],limitations:['This is US label publication history. UK authorisation and a local document approval require separate records.']};
}

export async function publication(target:RegisterTarget,read:Reader,asOf:string,check:Check) {
  const url='https://www.ebi.ac.uk/europepmc/webservices/rest/search?'+new URLSearchParams({
    query:'EXT_ID:'+target.scope+' AND SRC:MED',resultType:'core',format:'json',pageSize:'1'}).toString().replaceAll('+','%20');
  const {body}=(await read(url))!;
  const result=body.resultList?.result, row=Array.isArray(result)&&result.length===1?result[0]:null;
  if(body.hitCount!==1||row?.source!=='MED'||row.id!==target.scope||row.pmid!==target.scope) throw new CollectionError('TARGET_MISMATCH');
  const doi=typeof row.doi==='string'?row.doi.toLowerCase():undefined,revision=day(row.dateOfRevision,asOf);
  const types=z.array(z.string().min(1)).nonempty().safeParse(row.pubTypeList?.pubType);
  const notices=z.array(z.object({type:z.string().min(1)})).safeParse(row.commentCorrectionList===undefined?[]:row.commentCorrectionList?.commentCorrection);
  const alerts=types.success&&notices.success?[...types.data,...notices.data.map(x=>x.type)].filter(t=>/retract|erratum|corrigendum|corrected|correction|expression of concern/i.test(t)):null;
  return {sourceUrl:'https://europepmc.org/article/MED/'+target.scope,checks:[
    check('publication-doi','Index DOI matches the reviewed publication',doi?doi===target.reference:undefined,doi??'Unreported','Confirm the source of the cited publication.'),
    check('publication-revision','Indexed revision matches the reviewed date',revision?revision===target.record:undefined,'Reviewed '+target.record+' · indexed '+(revision??'unconfirmed'),'Review the changed bibliographic record.'),
    check('publication-notices','Indexed record has no listed correction or retraction signals',alerts?alerts.length===0:undefined,alerts?alerts.length+' indexed signals':'Unconfirmed','Inspect the publisher notice and assess the cited evidence.')
  ],limitations:['Checks the publication index and its listed notices. Clinical interpretation and appraisal of the evidence remain with the reviewer.']};
}

export async function guidance(target:RegisterTarget,read:Reader,asOf:string,check:Check) {
  const path='/guidance/'+target.scope,url='https://www.gov.uk'+path;
  const {body}=(await read('https://www.gov.uk/api/content'+path))!;
  if(body.content_id!==target.record||body.base_path!==path||body.document_type!=='detailed_guide') throw new CollectionError('TARGET_MISMATCH');
  const orgs=z.array(z.object({content_id:z.uuid()})).min(1).safeParse(body.links?.primary_publishing_organisation);
  const time=z.iso.datetime({offset:true}).safeParse(body.public_updated_at);
  const validTime=time.success&&Date.parse(time.data)<=Date.parse(asOf);
  const notice=body.withdrawn_notice;
  const active=notice&&typeof notice==='object'&&!Array.isArray(notice)
    ?Object.keys(notice).length===0?true:typeof notice.withdrawn_at==='string'?false:undefined:undefined;
  return {sourceUrl:url,checks:[
    check('guidance-publisher','MHRA is the primary publishing organisation',orgs.success?orgs.data.some(o=>o.content_id===mhra):undefined,orgs.success?orgs.data.map(o=>o.content_id).join(', '):'Unconfirmed','Confirm the publishing authority.'),
    check('guidance-revision','Public update matches the reviewed revision',validTime?Date.parse(time.data)===Date.parse(target.reference!):undefined,'Reviewed '+target.reference+' · published '+(validTime?time.data:'unconfirmed'),'Assess whether the revised guidance affects a controlled procedure.'),
    check('guidance-active','Guidance has no publisher withdrawal notice',active,active===true?'No notice listed':active===false?'Withdrawn':'Unconfirmed','Check the publication and any replacement guidance.')
  ],limitations:['Tracks the identified GOV.UK guidance record and its public updates. The responsible person assesses local applicability.']};
}
