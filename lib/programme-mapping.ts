import {csvEscape} from './obligations.mjs';

export type ProgrammeFileReference={id:string;sha256:string;version:number;reviewedAt:string};
type Item={title:string;evidenceHint:string;mappings?:readonly string[];reviewedFiles?:ProgrammeFileReference[];task:{id:string;title:string;status:string;ownerName:string;dueDate:string}|null};
export function programmeMappingCsv(plan:{name:string;recordHash:string;evidenceLimited?:boolean;items:Item[]}){
 const rows=plan.items.flatMap(item=>(item.mappings?.length?item.mappings:['']).flatMap(reference=>{
  const files=item.reviewedFiles?.length?item.reviewedFiles:[null];
  return files.map(file=>[plan.name,reference,item.task?.id,item.task?.title??item.title,item.task?.ownerName,item.task?.dueDate,item.task?.status??'Unavailable',
   item.evidenceHint,file?.id,file?.version,file?.reviewedAt,file?.sha256,item.reviewedFiles===undefined?'Task metadata only':plan.evidenceLimited?'First 1000 reviewed files':'Reviewed file metadata',plan.recordHash]);
 }));
 return [['Programme','Framework reference','Shared task ID','Control task','Owner','Due','Task status','Evidence requested','Reviewed file ID','Review version','Reviewed at','File SHA-256','Evidence scope','Programme record SHA-256'],...rows].map(row=>row.map(cell=>csvEscape(cell??'')).join(',')).join('\r\n');
}
