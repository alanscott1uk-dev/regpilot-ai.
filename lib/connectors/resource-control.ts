import {z} from 'zod';
type Rule={field:string;label:string;type:'true'|'false'|'recent'|'until'|'present'|'separate'|'ordered';days?:number;other?:string};
const yes=(field:string,label:string):Rule=>({field,label,type:'true'});
const recent=(field:string,label:string,days:number):Rule=>({field,label,type:'recent',days});
const until=(field:string,label:string):Rule=>({field,label,type:'until'});
export const profiles:Record<string,{name:string;rules:Rule[]}>={
 identity:{name:'Identity and access',rules:[yes('mfaEnabled','MFA enabled'),{field:'orphaned',label:'Account has an assigned identity',type:'false'},recent('accessReviewedAt','Access reviewed within 90 days',90)]},
 endpoint:{name:'Managed devices',rules:[yes('encrypted','Device encrypted'),yes('supported','Operating system supported'),recent('lastSeenAt','Device reported within 7 days',7)]},
 recovery:{name:'Backup and recovery',rules:[yes('encrypted','Backup encrypted'),recent('lastBackupAt','Successful backup within 48 hours',2),recent('restoredAt','Restore tested within 90 days',90)]},
 calibration:{name:'Calibration inventory',rules:[{field:'certificateId',label:'Calibration certificate referenced',type:'present'},until('validUntil','Calibration remains in date'),yes('inRange','Source reports an in-range sample'),recent('sampledAt','Reading received within 24 hours',1)]},
 laboratory:{name:'Quality decisions',rules:[yes('approved','Source records an approved decision'),yes('authorisedReviewer','Source confirms reviewer authority'),{field:'reviewerId',other:'authorId',type:'separate',label:'Reviewer differs from author'},{field:'decidedAt',other:'modifiedAt',type:'ordered',label:'Decision covers the current revision'}]},
 changeApproval:{name:'Production change approval',rules:[yes('approved','Change was approved'),{field:'approverId',other:'authorId',type:'separate',label:'Approver is independent of the change author'},{field:'deployedAt',other:'approvedAt',type:'ordered',label:'Deployment followed approval'}]},
 supplierPayment:{name:'Supplier payment authorisation',rules:[yes('verified','Payment details independently verified'),{field:'approverId',other:'requesterId',type:'separate',label:'Request and approval have separate owners'},{field:'paidAt',other:'approvedAt',type:'ordered',label:'Payment followed approval'}]},
 equipment:{name:'Equipment qualification',rules:[yes('qualified','Equipment is qualified for use'),until('qualificationExpiresAt','Qualification remains in date'),{field:'reviewerId',other:'operatorId',type:'separate',label:'Qualification has an independent reviewer'}]},
 training:{name:'Staff competence',rules:[yes('completed','Training completed'),yes('assessed','Competence assessment recorded'),until('expiresAt','Qualification remains in date')]}
};
export const profileFields=(profile:string)=>[...new Set((profiles[profile]?.rules??[]).flatMap(rule=>rule.other?[rule.field,rule.other]:[rule.field]))];
const path=z.string().max(150).regex(/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*){0,4}$/).refine(v=>v.split('.').every(k=>!['constructor','prototype','__proto__'].includes(k)));
export const resourcePolicy=z.object({profile:z.enum(['identity','endpoint','recovery','calibration','laboratory','training','changeApproval','supplierPayment','equipment']),mapping:z.record(z.string().max(40),path)}).strict().refine(p=>{
 const fields=profileFields(p.profile);return Object.keys(p.mapping).length===fields.length&&fields.every(k=>Object.hasOwn(p.mapping,k))&&new Set(Object.values(p.mapping)).size===fields.length;
},'Map every field to a distinct source field');
export type ResourcePolicy=z.infer<typeof resourcePolicy>;
export type RuleState='PASS'|'FAIL'|'UNKNOWN';
function read(row:unknown,path:string){
 let current=row;
 for(const part of path.split('.')){
  if(!current||typeof current!=='object'||Array.isArray(current)||!Object.hasOwn(current,part))return undefined;
  current=(current as Record<string,unknown>)[part];
 }
 return current;
}
function instant(value:unknown){return z.iso.datetime({offset:true}).safeParse(value).success?Date.parse(value as string):NaN;}
export function evaluateResource(row:unknown,policy:ResourcePolicy,now:number):RuleState[]{
 return profiles[policy.profile].rules.map(rule=>{
  const value=read(row,policy.mapping[rule.field]),other=rule.other?read(row,policy.mapping[rule.other]):null;
  let result:boolean|undefined;
  if(rule.type==='true'||rule.type==='false'){if(typeof value==='boolean')result=value===(rule.type==='true');}
  if(rule.type==='present'&&typeof value==='string')result=value.trim().length>0;
  if(rule.type==='separate'&&typeof value==='string'&&typeof other==='string'&&value.trim()&&other.trim())result=value.trim()!==other.trim();
  if(rule.type==='until'&&Number.isFinite(instant(value)))result=instant(value)>now;
  if(rule.type==='recent'&&Number.isFinite(instant(value)))result=instant(value)<=now&&now-instant(value)<=rule.days!*86400000;
  if(rule.type==='ordered'&&Number.isFinite(instant(value))&&Number.isFinite(instant(other)))result=instant(value)>=instant(other)&&instant(value)<=now;
  return result===undefined?'UNKNOWN':result?'PASS':'FAIL';
 });
}
