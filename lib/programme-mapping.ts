import {csvEscape} from './obligations.mjs';

type Item={title:string;evidenceHint:string;mappings?:readonly string[];task:{id:string;title:string;status:string;ownerName:string;dueDate:string}|null};
export function programmeMappingCsv(plan:{name:string;recordHash:string;items:Item[]}){
 const rows=plan.items.flatMap(item=>(item.mappings?.length?item.mappings:['']).map(reference=>[
  plan.name,reference,item.task?.id,item.task?.title??item.title,item.task?.ownerName,item.task?.dueDate,item.task?.status??'Unavailable',item.evidenceHint,plan.recordHash
 ]));
 return [['Programme','Framework reference','Shared task ID','Control task','Owner','Due','Task status','Evidence requested','Programme record SHA-256'],...rows].map(row=>row.map(cell=>csvEscape(cell??'')).join(',')).join('\r\n');
}
