import {csvEscape} from './obligations.mjs';
import type {ProgrammeFileReference} from './programme-mapping';

type Task={id:string;title:string;status:string;ownerName:string;href:string};
type Plan={id:string;name:string;recordHash:string;evidenceLimited?:boolean;items:{mappings?:string[];task:Task|null;reviewedFiles?:ProgrammeFileReference[]}[]};
type Scope={rows:{reference:string;area:string;decision:string;reason:string;reviewerId:string|null;reviewedAt:string|null}[]};
type LinkedTask={programme:string;task:Task;criteria:string[];files:ProgrammeFileReference[]};
const annexPrefix='ISO/IEC 27001:2022 · ',socPrefix='SOC 2 Security · ';
function codes(refs:string[],prefix:string){return refs.filter(ref=>ref.startsWith(prefix)).flatMap(ref=>ref.slice(prefix.length).split(',').map(s=>s.trim()));}

export function buildCrosswalk(annex:Plan,combined:Plan,scope:Scope){
 const linked=new Map<string,LinkedTask[]>();
 for(const plan of [annex,combined])for(const item of plan.items){
  if(!item.task)continue;
  const mappings=item.mappings??[],criteria=plan===combined?codes(mappings,socPrefix):[];
  const link={programme:plan.name,task:item.task,criteria,files:item.reviewedFiles??[]};
  for(const code of new Set(codes(mappings,annexPrefix).filter(s=>/^A\.[5-8]\.\d+$/.test(s)))){
   const entries=linked.get(code)??[];entries.push(link);linked.set(code,entries);
  }
 }
 const rows=scope.rows.map(row=>({...row,code:row.reference.slice(annexPrefix.length),tasks:linked.get(row.reference.slice(annexPrefix.length))??[]}));
 const shared=rows.filter(row=>row.tasks.some(link=>link.criteria.length));
 const fileIds=new Set(shared.flatMap(row=>row.tasks.flatMap(link=>link.files.map(file=>file.id))));
 return {annex:{id:annex.id,name:annex.name,recordHash:annex.recordHash},combined:{id:combined.id,name:combined.name,recordHash:combined.recordHash},
  shared:shared.length,reviewedFiles:fileIds.size,limited:Boolean(annex.evidenceLimited||combined.evidenceLimited),rows};
}
export type Crosswalk=ReturnType<typeof buildCrosswalk>;
export function crosswalkCsv(report:Crosswalk){
 const records:unknown[][]=[['Annex A control','Area','Applicability decision','Scope reason','Scope reviewer','Decision time','Source programme','SOC 2 criteria','Task ID','Task','Owner','Task status','Evidence ID','Review version','Reviewed at','SHA-256','Annex A record hash','Combined programme record hash']];
 for(const row of report.rows){
  for(const link of row.tasks.length?row.tasks:[null]){
   for(const file of link?.files.length?link.files:[null])records.push([row.code,row.area,row.decision,row.reason,row.reviewerId,row.reviewedAt,
    link?.programme,link?.criteria.join(', '),link?.task.id,link?.task.title,link?.task.ownerName,link?.task.status,file?.id,file?.version,file?.reviewedAt,file?.sha256,report.annex.recordHash,report.combined.recordHash]);
  }
 }
 return records.map(record=>record.map(csvEscape).join(',')).join('\r\n');
}
