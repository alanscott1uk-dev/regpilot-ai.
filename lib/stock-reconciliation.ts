import {z} from 'zod';
import type {ReviewedFile} from './server/reviewed-files';

const label = z.string().trim().min(1).max(120);
const quantity = z.string().regex(/^(0|[1-9]\d{0,6})(\.\d{1,3})?$/, 'Enter a non-negative quantity with up to three decimal places.');
const units = ['packs', 'units', 'g', 'mL'] as const;
const step = z.object({
 reference: label, direction: z.enum(['IN', 'OUT']), quantity,
 at: z.iso.datetime()
}).strict();

const registerFields = z.object({
 site:label, product:label, batch:label, unit:z.enum(units), openedAt:z.iso.datetime(),
 opening:quantity, movements:z.array(step).max(40)
}).strict();
function checkRegister(data:z.infer<typeof registerFields>, issue:z.RefinementCtx) {
 const reject=(message:string)=>issue.addIssue({code:'custom',message});
 const start=Date.parse(data.openedAt), references=new Set<string>();
 let previous=start;
 for(const movement of data.movements){
  const at=Date.parse(movement.at), reference=movement.reference.toLowerCase();
  if(at<previous || at<=start)reject('List movements in time order after the opening balance.');
  if(references.has(reference))reject('Give each movement its own register line reference.');
  if(scaled(movement.quantity)===0)reject('Enter a movement quantity greater than zero.');
  previous=at;
  references.add(reference);
 }
 if(['packs','units'].includes(data.unit) && [data.opening,...data.movements.map(m=>m.quantity)].some(n=>scaled(n)%1000!==0))
  reject('Use whole numbers for packs and individual units.');
}
export const stockRegisterSchema=registerFields.superRefine(checkRegister);
export const stockCountSchema=registerFields.extend({
 countedAt:z.iso.datetime(), physical:quantity, registerId:z.uuid(), countId:z.uuid(),
 notes:z.string().trim().min(10).max(800)
}).strict().superRefine((data,issue)=>{
 checkRegister(data,issue);
 const reject=(message:string)=>issue.addIssue({code:'custom',message});
 if(data.registerId===data.countId)reject('Choose separate movement and physical count records.');
 const end=Date.parse(data.countedAt);
 if(Date.parse(data.openedAt)>=end)reject('The opening balance must precede the physical count.');
 if(data.movements.some(m=>Date.parse(m.at)>end))reject('The physical count must cover the last movement entered.');
 if(['packs','units'].includes(data.unit) && scaled(data.physical)%1000!==0)reject('Use whole numbers for packs and individual units.');
});

function scaled(value:string) {
 const [whole, fraction = ''] = value.split('.');
 return Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
}
function amount(value:number) { return String(value / 1000); }
export type StockCount = z.infer<typeof stockCountSchema>;
export function reconcileStock(count:StockCount) {
 let balance = scaled(count.opening), received = 0, supplied = 0, negative = false;
 for (const movement of count.movements) {
  const value = scaled(movement.quantity);
  if (movement.direction === 'IN') { received += value; balance += value; }
  else { supplied += value; balance -= value; }
  if (balance < 0) negative = true;
 }
 const difference = scaled(count.physical) - balance;
 return {received:amount(received), supplied:amount(supplied), expected:amount(balance), difference:amount(difference),
  negative, matched:difference === 0 && !negative};
}
export const stockReviewSchema = z.object({
 countKey:z.uuid(), decision:z.enum(['VERIFIED','RECOUNT']), notes:z.string().trim().min(15).max(800)
}).strict();
export type StockRecord = {
 key:string; cycle:number; actor:string; at:string; count:StockCount; totals:ReturnType<typeof reconcileStock>;
 files:ReviewedFile[];
 review:null|{actor:string;at:string;decision:'VERIFIED'|'RECOUNT';notes:string};
};
export function stockBlocker(latest:StockRecord | undefined) {
 if (!latest) return null;
 if (!latest.review) return 'Have a separate quality administrator review the latest stock reconciliation.';
 if (latest.review.decision === 'RECOUNT') return 'Record and review the requested stock recount.';
 if (!latest.totals.matched) return 'Investigate the stock discrepancy and provide a reconciled count before closure.';
 return null;
}
