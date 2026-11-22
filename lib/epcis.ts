import {z} from 'zod';

const context='https://ref.gs1.org/standards/epcis/epcis-context.jsonld';
const gs1Context=z.union([z.literal(context),z.tuple([z.literal(context)])]);
const instant=z.iso.datetime({offset:true});
const epc=z.string().max(100).regex(/^urn:epc:id:sgtin:\d{6,12}\.\d{1,7}\.[A-Za-z0-9_-]{1,20}$/).refine(v=>{
 const [company,indicator]=v.slice('urn:epc:id:sgtin:'.length).split('.');
 return company.length+indicator.length===13;
},'Invalid SGTIN company prefix and item reference');
const location=z.string().max(100).regex(/^urn:epc:id:sgln:\d{6,12}\.\d{0,6}\.[A-Za-z0-9_-]{1,20}$/).refine(v=>{
 const [company,site]=v.slice('urn:epc:id:sgln:'.length).split('.');
 return company.length+site.length===12;
},'Invalid SGLN company prefix and location reference');
const point=z.object({id:location}).strict();
const transaction=z.object({type:z.enum(['desadv','urn:epcglobal:cbv:btt:desadv','https://ref.gs1.org/cbv/BTT-desadv']),bizTransaction:z.string().min(5).max(200).regex(/^(?:urn:[a-z0-9-]+:|https:\/\/)[A-Za-z0-9./:_%-]+$/)}).strict();
const event=z.object({type:z.literal('ObjectEvent'),eventID:z.string().regex(/^urn:uuid:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i),eventTime:instant,
 eventTimeZoneOffset:z.string().regex(/^[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00)$/),recordTime:instant.optional(),action:z.literal('OBSERVE'),
 bizStep:z.enum(['shipping','receiving','urn:epcglobal:cbv:bizstep:shipping','urn:epcglobal:cbv:bizstep:receiving','https://ref.gs1.org/cbv/BizStep-shipping','https://ref.gs1.org/cbv/BizStep-receiving']),
 readPoint:point,bizLocation:point.optional(),bizTransactionList:z.tuple([transaction]),epcList:z.array(epc).min(1).max(80).refine(v=>new Set(v).size===v.length,'Duplicate pack identity'),
 disposition:z.enum(['in_transit','in_progress','active','urn:epcglobal:cbv:disp:in_transit','urn:epcglobal:cbv:disp:in_progress','urn:epcglobal:cbv:disp:active','https://ref.gs1.org/cbv/Disp-in_transit','https://ref.gs1.org/cbv/Disp-in_progress','https://ref.gs1.org/cbv/Disp-active']).optional()
}).strict();
export const epcisDocument=z.object({'@context':gs1Context,type:z.literal('EPCISDocument'),schemaVersion:z.literal('2.0'),creationDate:instant,
 epcisBody:z.object({eventList:z.tuple([event])}).strict()}).strict();
export const epcisTransfer=z.object({kind:z.literal('EPCIS_TRANSFER'),shipping:epcisDocument,receiving:epcisDocument}).strict().superRefine((pair,ctx)=>{
 for(const side of ['shipping','receiving'] as const){
  const file=pair[side],e=file.epcisBody.eventList[0];
  if(!e.bizStep.endsWith(side))ctx.addIssue({code:'custom',message:'Select the '+side+' document for the '+side+' field'});
  if(Date.parse(file.creationDate)<Date.parse(e.eventTime)||(e.recordTime&&Date.parse(e.recordTime)<Date.parse(e.eventTime)))ctx.addIssue({code:'custom',message:'Document and record timestamps must follow the observed event'});
 }
});
export type EpcisTransfer=z.infer<typeof epcisTransfer>;
export function reconcileTransfer(pair:EpcisTransfer){
 const ship=pair.shipping.epcisBody.eventList[0],receive=pair.receiving.epcisBody.eventList[0];
 const sent=new Set(ship.epcList),arrived=new Set(receive.epcList);
 const missing=ship.epcList.filter(id=>!arrived.has(id)),unexpected=receive.epcList.filter(id=>!sent.has(id));
 const reasons:string[]=[];
 if(ship.bizTransactionList[0].bizTransaction!==receive.bizTransactionList[0].bizTransaction)reasons.push('Dispatch advice references differ');
 if(ship.eventID.toLowerCase()===receive.eventID.toLowerCase())reasons.push('Both records use the same event identity');
 if(ship.readPoint.id===receive.readPoint.id)reasons.push('Both records use the same read point');
 if(Date.parse(receive.eventTime)<Date.parse(ship.eventTime))reasons.push('Receipt predates dispatch');
 const outcome=reasons.length?'UNKNOWN':missing.length||unexpected.length?'FAIL':'PASS';
 return {outcome:outcome as 'UNKNOWN'|'FAIL'|'PASS',sent:sent.size,received:arrived.size,missing,unexpected,reasons};
}
export function transferFinding(pair:EpcisTransfer){
 const r=reconcileTransfer(pair);
 return 'Pack reconciliation · '+r.outcome+' · '+r.sent+' dispatched, '+r.received+' received, '+r.missing.length+' missing, '+r.unexpected.length+' unexpected. '+r.reasons.join('. ');
}
