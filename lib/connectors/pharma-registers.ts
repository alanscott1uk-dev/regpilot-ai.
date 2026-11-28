import {publicationTargets,labelHistory,publication,guidance} from './publication-registers';
import {z} from 'zod';
import {providerReader} from './bounded-http';
import {CollectionError} from './collection-error';
import type {Observation} from './observation';
import type {ConnectorCheck} from './github';

import type {PublicRegister,RegisterTarget} from './register-targets';
export {publicRegisters,referenceRegisters,type PublicRegister,type RegisterTarget} from './register-targets';
const studyStates=['NOT_YET_RECRUITING','RECRUITING','ENROLLING_BY_INVITATION','ACTIVE_NOT_RECRUITING','COMPLETED','SUSPENDED','TERMINATED','WITHDRAWN','UNKNOWN','AVAILABLE','NO_LONGER_AVAILABLE','TEMPORARILY_NOT_AVAILABLE','APPROVED_FOR_MARKETING','WITHHELD'] as const;
export const registerTargets={
 ...publicationTargets,
 NHSBSA_MAPPING:z.object({scope:z.literal('bnf-snomed-mapping'),record:z.uuid()}),
 CLINICALTRIALS_GOV:z.object({scope:z.string().regex(/^NCT\d{8}$/),record:z.enum(studyStates)}),
 OPENFDA_RECALL:z.object({scope:z.string().regex(/^[1-9]\d{0,11}$/),record:z.string().regex(/^D-\d{1,5}-\d{4}$/),reference:z.enum(['I','II','III'])})
};
type Read=ReturnType<typeof providerReader>;
function check(id:string,label:string,value:boolean|undefined,observed:string,nextStep:string):ConnectorCheck{
 return {id,label,status:value===undefined?'UNKNOWN':value?'PASS':'FAIL',observed,nextStep};
}
const isoDay=(value:unknown,asOf:string)=>typeof value==='string'&&z.iso.date().safeParse(value).success&&value<=asOf.slice(0,10)?value:undefined;
function fdaDay(value:unknown,asOf:string){return typeof value==='string'&&/^\d{8}$/.test(value)?isoDay(value.slice(0,4)+'-'+value.slice(4,6)+'-'+value.slice(6),asOf):undefined;}
function month(name:unknown){return typeof name==='string'?(name.match(/^BNF_SNOMED_MAPPING_DATA_(20\d{2}(?:0[1-9]|1[0-2]))$/i)?.[1]):undefined;}

async function mapping(input:RegisterTarget,read:Read){
 const {scope,record}=input,base='https://opendata.nhsbsa.net/api/3/action/';
 const [{body:dataset},{body:resource}]=await Promise.all([
  read(base+'package_show?id='+scope).then(r=>r!),read(base+'resource_show?id='+record).then(r=>r!)
 ]);
 const pkg=dataset.result,item=resource.result;
 if(dataset.success!==true||resource.success!==true||pkg?.name!==scope||!z.uuid().safeParse(pkg.id).success||item?.id!==record||item.package_id!==pkg.id)throw new CollectionError('TARGET_MISMATCH');
 const entries=z.array(z.object({id:z.string(),name:z.string().nullish(),format:z.string().nullish(),state:z.string().nullish()})).max(1500).safeParse(pkg.resources);
 if(!entries.success)throw new CollectionError('INVALID_RESPONSE');
 const found=entries.data.filter(r=>r.id===record);
 if(found.length!==1||found[0].name!==item.name||found[0].format!==item.format)throw new CollectionError('TARGET_MISMATCH');
 const csv=typeof item.format==='string'?item.format.toUpperCase()==='CSV':undefined;
 const approved=month(item.name);
 const activeCsv=entries.data.filter(r=>r.format?.toUpperCase()==='CSV'&&r.state==='active');
 const months=activeCsv.map(r=>month(r.name)).filter((m):m is string=>!!m).sort();
 const complete=Number.isInteger(pkg.num_resources)&&pkg.num_resources===entries.data.length
  &&entries.data.every(r=>!!r.format&&!!r.state)&&new Set(entries.data.map(r=>r.id)).size===entries.data.length
  &&months.length===activeCsv.length&&new Set(months).size===months.length;
 const latest=months.at(-1),url='https://opendata.nhsbsa.net/dataset/'+scope+'/resource/'+record;
 return {sourceUrl:url,checks:[
  check('mapping-active','Dataset and reviewed release are active',typeof item.state==='string'&&typeof pkg.state==='string'?pkg.state==='active'&&item.state==='active':undefined,[pkg.state,item.state].join(' / '),'Check the publisher for a withdrawal.'),
  check('mapping-csv','Reviewed release is a CSV resource',csv,String(item.format??'Unreported'),'Review changes to the data format.'),
  check('mapping-release','Reviewed mapping matches the latest published monthly CSV',approved&&latest&&complete?approved===latest:undefined,'Reviewed '+(approved??'unconfirmed')+' · latest '+(latest??'unconfirmed'),'Review the new mapping release before updating local reference data.')
 ],limitations:['Checks the published release and its identity. Row-level mapping accuracy needs a separate assessment. Contains NHS Business Services Authority information licensed under the Open Government Licence v3.0.']};
}

async function trial(input:RegisterTarget,read:Read,asOf:string){
 const {scope,record}=input,fields='NCTId,OverallStatus,LastUpdatePostDate,ResultsFirstPostDate';
 const {body}=(await read('https://clinicaltrials.gov/api/v2/studies/'+scope+'?fields='+fields))!;
 const protocol=body.protocolSection;
 if(protocol?.identificationModule?.nctId!==scope)throw new CollectionError('TARGET_MISMATCH');
 const status=protocol.statusModule,reported=z.enum(studyStates).safeParse(status?.overallStatus);
 const updated=isoDay(status?.lastUpdatePostDateStruct?.date,asOf),posted=isoDay(status?.resultsFirstPostDateStruct?.date,asOf);
 const checks=[
  check('trial-status','Registry status matches the reviewed status',reported.success?reported.data===record:undefined,reported.success?reported.data:'Unreported','Compare the registry change with the study file.'),
  check('trial-update','Public registry revision has a valid posting date',updated?true:undefined,updated??'Unconfirmed','Check the source revision before relying on the record.')
 ];
 if(record==='COMPLETED')checks.push(check('trial-results','Completed study has a public results posting',reported.success&&reported.data==='COMPLETED'&&updated?(posted?posted<=updated:status.resultsFirstPostDateStruct==null?false:undefined):undefined,posted??'No confirmed results posting','Review the public disclosure with the study owner.'));
 return {sourceUrl:'https://clinicaltrials.gov/study/'+scope,checks,limitations:['Registry metadata describes the public record. Publication obligations and deadlines require a study-specific assessment.']};
}

async function recall(input:RegisterTarget,read:Read,asOf:string){
 const {record,scope,reference}=input,query=new URLSearchParams({search:'recall_number:"'+record+'" AND event_id:"'+scope+'"',limit:'2'});
 const sourceUrl='https://api.fda.gov/drug/enforcement.json?'+query;
 const {body}=(await read(sourceUrl))!,row=body.results?.[0];
 if(body.meta?.results?.total!==1||!Array.isArray(body.results)||body.results.length!==1||row?.recall_number!==record||String(row.event_id)!==scope||row.product_type!=='Drugs')throw new CollectionError('TARGET_MISMATCH');
 const initiation=fdaDay(row.recall_initiation_date,asOf),report=fdaDay(row.report_date,asOf),end=fdaDay(row.termination_date,asOf);
 const classification=z.enum(['Class I','Class II','Class III']).safeParse(row.classification),status=z.enum(['Ongoing','Completed','Terminated']).safeParse(row.status);
 return {sourceUrl,checks:[
  check('recall-class','Recall classification matches the reviewed class',classification.success?classification.data==='Class '+reference:undefined,classification.success?classification.data:'Unconfirmed','Review changes in the published classification.'),
  check('recall-report','Report date follows recall initiation',report&&initiation?report>=initiation:undefined,(initiation??'Unconfirmed')+' / '+(report??'Unconfirmed'),'Check the published recall chronology.'),
  check('recall-closure','FDA recorded a termination and a valid termination date',status.success?(status.data!=='Terminated'?false:end&&initiation?end>=initiation:undefined):undefined,(status.success?status.data:'Unconfirmed')+' · '+(end??'no confirmed termination date'),'Follow up on active recalls and verify the site response separately.')
 ],limitations:['US enforcement record for the selected recall and event. It establishes neither UK applicability nor the disposition of a local batch.']};
}

export async function collectPublicRegister(provider:PublicRegister,target:RegisterTarget,fetcher:typeof fetch=fetch,capturedAt=new Date().toISOString()):Promise<Observation>{
 const input=registerTargets[provider].strict().safeParse(target);
 if(!input.success)throw new CollectionError('INVALID_TARGET');
 // Europe PMC's full bibliographic record can take longer than a standard read.
 // Keep its complete request, including retries, within the 90-second connector lease.
 const read=providerReader(fetcher,{},provider==='EUROPE_PMC'?45_000:undefined);
 const result=await ({NHSBSA_MAPPING:mapping,CLINICALTRIALS_GOV:trial,OPENFDA_RECALL:recall,DAILYMED_LABEL:labelHistory,EUROPE_PMC:publication,MHRA_GUIDANCE:guidance}[provider])(input.data,read,capturedAt,check);
 return {...result,engine:provider.toLowerCase()+'-v1',capturedAt};
}
