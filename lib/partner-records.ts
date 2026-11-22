import {z} from 'zod';

const reference=z.string().min(1).max(96).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const minText=z.string().trim().min(2).max(120);
const sourceLink=z.url({protocol:/^https$/}).max(350).refine(value=>{
 try{const url=new URL(value);return !url.username&&!url.password&&!url.search&&!url.hash;}catch{return false;}
},'Use a permanent HTTPS source location without credentials, query parameters or a fragment');

const permittedBuyers=z.array(z.email().trim().toLowerCase().max(254)).min(1).max(10).refine(v=>new Set(v).size===v.length).optional();
const records=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('SUPPLIER_RELATION'),permittedBuyers,buyerRef:reference,supplierRef:reference,upstreamRef:reference,consentRef:reference,consentExpiresAt:z.iso.datetime()}).strict(),
 z.object({kind:z.literal('SUPPLIER_ASSESSMENT'),permittedBuyers,supplierRef:reference,assessment:z.enum(['SECURITY','ESG']),assessmentRef:reference,consentRef:reference,consentExpiresAt:z.iso.datetime(),result:z.enum(['CLEAR','EXCEPTION','UNASSESSED'])}).strict(),
 z.object({kind:z.literal('MODEL_CHANGE'),systemRef:reference,vendorRef:reference,modelRef:reference,modelVersion:reference,approval:z.enum(['PENDING','APPROVED','DECLINED']),decisionRef:reference.optional()}).strict(),
 z.object({kind:z.literal('SPECIALIST_ATTESTATION'),subject:z.enum(['PRIVACY','ETHICS','RESILIENCE']),scopeRef:reference,decisionRef:reference,decision:z.enum(['APPROVED','ACTION_REQUIRED','UNDER_REVIEW']),retainUntil:z.iso.date()}).strict(),
 z.object({kind:z.literal('PRODUCT_EVENT'),event:z.enum(['BATCH_RELEASE','DEVICE_CHANGE','REGISTRATION']),productRef:reference,eventRef:reference,decision:z.enum(['AUTHORISED','ON_HOLD','WITHDRAWN']),decisionRef:reference}).strict(),
 z.object({kind:z.literal('CALIBRATED_READING'),siteRef:reference,sensorRef:reference,calibrationRef:reference,calibratedAt:z.iso.datetime(),calibrationDue:z.iso.datetime(),unit:z.enum(['CELSIUS','PERCENT_RH']),minimum:z.number().finite(),maximum:z.number().finite(),reading:z.number().finite(),followUpRef:reference.optional()}).strict(),
 z.object({kind:z.literal('FOOD_HAZARD'),siteRef:reference,hazardRef:reference,result:z.enum(['CONTROLLED','DEVIATION','UNKNOWN']),correctiveActionRef:reference.optional()}).strict()
]);

export const partnerRecordSchema=z.object({
 schemaVersion:z.literal(1),recordId:reference,revision:z.number().int().min(1).max(1000000),previousHash:hash.optional(),
 sourceSystem:minText,sourceVersion:reference,sourceUrl:sourceLink.optional(),decisionOwnerRef:reference,
 state:z.enum(['CURRENT','DISPUTED','WITHDRAWN']),record:records
}).strict().superRefine((v,ctx)=>{
 const add=(message:string)=>ctx.addIssue({code:'custom',message});
 if((v.revision>1)!==Boolean(v.previousHash))add('Supply the preceding receipt hash for every revision after the first');
 const r=v.record;
 if(r.kind==='SUPPLIER_RELATION'&&new Set([r.buyerRef,r.supplierRef,r.upstreamRef]).size!==3)add('Use three distinct company references for the buyer and its two supplier tiers');
 if(r.kind==='MODEL_CHANGE'&&r.approval!=='PENDING'&&!r.decisionRef)add('Identify the model decision');
 if(r.kind==='CALIBRATED_READING'&&(r.minimum>=r.maximum||Date.parse(r.calibratedAt)>=Date.parse(r.calibrationDue)))add('Check the operating limits and calibration interval');
});
export type PartnerRecord=z.infer<typeof partnerRecordSchema>;
export const partnerLabels:Record<PartnerRecord['record']['kind'],string>={
 SUPPLIER_RELATION:'Consented second-tier supplier relationship',SUPPLIER_ASSESSMENT:'Supplier security or ESG assessment',MODEL_CHANGE:'AI model change',SPECIALIST_ATTESTATION:'Specialist decision',PRODUCT_EVENT:'Product release, change or registration',CALIBRATED_READING:'Calibrated site reading',FOOD_HAZARD:'Food hazard decision'
};

export function partnerValidity(record:PartnerRecord,time:number){
 if(record.state!=='CURRENT')return record.state==='WITHDRAWN'?'The source withdrew this record':'The source marked this record as disputed';
 const r=record.record;
 if('consentExpiresAt' in r&&Date.parse(r.consentExpiresAt)<=time)return 'Supplier consent expired';
 if(r.kind==='SPECIALIST_ATTESTATION'&&new Date(time).toISOString().slice(0,10)>r.retainUntil)return 'The specialist reporting period ended';
 return '';
}

export function partnerOutcome(record:PartnerRecord,observedAt:string):'PASS'|'FAIL'|'UNKNOWN' {
 if(partnerValidity(record,Date.parse(observedAt)))return 'UNKNOWN';
 const r=record.record;
 switch(r.kind){
  case 'SUPPLIER_RELATION':return 'PASS';
  case 'SUPPLIER_ASSESSMENT':return r.result==='CLEAR'?'PASS':r.result==='EXCEPTION'?'FAIL':'UNKNOWN';
  case 'MODEL_CHANGE':return r.approval==='APPROVED'?'PASS':r.approval==='DECLINED'?'FAIL':'UNKNOWN';
  case 'SPECIALIST_ATTESTATION':return r.decision==='APPROVED'?'PASS':r.decision==='ACTION_REQUIRED'?'FAIL':'UNKNOWN';
  case 'PRODUCT_EVENT':return r.decision==='AUTHORISED'?'PASS':'FAIL';
  case 'CALIBRATED_READING':{
   const at=Date.parse(observedAt);
   if(at<Date.parse(r.calibratedAt)||at>=Date.parse(r.calibrationDue))return 'UNKNOWN';
   return r.reading<r.minimum||r.reading>r.maximum?'FAIL':'PASS';
  }
  case 'FOOD_HAZARD':return r.result==='CONTROLLED'?'PASS':r.result==='DEVIATION'?'FAIL':'UNKNOWN';
 }
}

export const partnerTopics:Record<PartnerRecord['record']['kind'],string>={
 SUPPLIER_RELATION:'tier two supply chain dependency fourth party',
 SUPPLIER_ASSESSMENT:'supplier security ESG sustainability assessment',
 MODEL_CHANGE:'AI model vendor inventory approval model change',
 SPECIALIST_ATTESTATION:'privacy ethics resilience specialist attestation',
 PRODUCT_EVENT:'product batch release device change registration',
 CALIBRATED_READING:'temperature humidity sensor calibration excursion',
 FOOD_HAZARD:'food safety allergen hazard corrective action'
};

export function partnerFinding(record:PartnerRecord['record']){
 switch(record.kind){
  case 'CALIBRATED_READING':return `${record.sensorRef} at ${record.siteRef}: ${record.reading} ${record.unit==='CELSIUS'?'°C':'% RH'} (limits ${record.minimum}–${record.maximum}). Calibration ${record.calibrationRef}.`;
  case 'FOOD_HAZARD':return `${record.hazardRef} at ${record.siteRef}: ${record.result}. Corrective action ${record.correctiveActionRef??'unrecorded'}.`;
  case 'PRODUCT_EVENT':return `${record.productRef}: ${record.event} · ${record.decision} · Decision ${record.decisionRef}.`;
  case 'MODEL_CHANGE':return `${record.systemRef} uses ${record.vendorRef} / ${record.modelRef} ${record.modelVersion}. Approval: ${record.approval}.`;
  case 'SPECIALIST_ATTESTATION':return `${record.subject} · ${record.scopeRef}: ${record.decision} · Decision ${record.decisionRef}.`;
  case 'SUPPLIER_RELATION':return `${record.buyerRef} sources from ${record.supplierRef}, which names ${record.upstreamRef} upstream.`;
  case 'SUPPLIER_ASSESSMENT':return `${record.supplierRef} · ${record.assessment} assessment ${record.assessmentRef}: ${record.result}.`;
 }
}
