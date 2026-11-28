import {z} from 'zod';
import {stockRegisterSchema} from './stock-reconciliation';

const cell=z.union([z.string().max(160),z.number().finite()]).transform(v=>String(v).trim());
const transfer=z.object({format:z.literal('regpilot-excel-stock-v1'),rows:z.array(z.array(cell).length(8)).min(3).max(43)}).strict();
const headers=['type','time utc','reference','quantity','site','product','batch','unit'];
export function parseExcelStock(value:unknown){
 const parsed=transfer.safeParse(value);
 if(!parsed.success)throw Error('Choose a RegPilot Excel stock selection with eight columns and up to 40 movements.');
 const [head,...rows]=parsed.data.rows;
 if(!head.every((v,i)=>v.toLowerCase()===headers[i]))throw Error('Use the eight column headers in the Excel example, in the same order.');
 const first=rows[0],last=rows[rows.length-1],middle=rows.slice(1,-1);
 if(first[0].toUpperCase()!=='OPEN'||last[0].toUpperCase()!=='COUNT'||middle.some(r=>!['IN','OUT'].includes(r[0].toUpperCase())))
  throw Error('Start with OPEN, list receipts as IN and removals as OUT, and finish with COUNT.');
 if(rows.some(r=>r.slice(4).some((v,i)=>v!==first[4+i])))throw Error('Select only one site, product, batch and unit.');
 function time(iso:string){
  if(!z.iso.datetime().safeParse(iso)||!iso.endsWith('Z')||!Number.isFinite(Date.parse(iso)))throw Error('Use ISO UTC timestamps stored as text, ending in Z.');
  return new Date(iso).toISOString();
 }
 const fields={site:first[4],product:first[5],batch:first[6],unit:first[7],opening:first[3],openedAt:time(first[1]),
  movements:middle.map(r=>({reference:r[2],quantity:r[3],direction:r[0].toUpperCase(),at:time(r[1])}))};
 const register=stockRegisterSchema.safeParse(fields);
 if(!register.success)throw Error(register.error.issues[0].message);
 const countedAt=time(last[1]),physical=last[3];
 if(countedAt<=fields.openedAt||fields.movements.some(r=>r.at>countedAt)||Date.parse(countedAt)>Date.now())throw Error('The count must follow the opening balance, cover every movement and be in the past.');
 if(!/^(0|[1-9]\d{0,6})(\.\d{1,3})?$/.test(physical)||['packs','units'].includes(fields.unit)&&Number(physical)%1!==0)throw Error('Check the physical quantity and unit.');
 return {...register.data,countedAt,physical};
}
export function localStockTime(utc:string){
 const date=new Date(utc);
 const local=new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,-1);
 if(new Date(local).getTime()!==date.getTime())throw Error('The local clock repeats at this time. Open the import in a browser set to UTC to keep the exact timestamp.');
 return local;
}
