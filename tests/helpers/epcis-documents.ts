import {randomUUID} from 'node:crypto';
export const pack=(serial:string)=>'urn:epc:id:sgtin:0614141.112345.'+serial;
export function epcisFile(side:'shipping'|'receiving',serials:string[],at:string){
 return {'@context':['https://ref.gs1.org/standards/epcis/epcis-context.jsonld'],type:'EPCISDocument',schemaVersion:'2.0',creationDate:at,
  epcisBody:{eventList:[{type:'ObjectEvent',eventID:'urn:uuid:'+randomUUID(),eventTime:at,eventTimeZoneOffset:'+00:00',action:'OBSERVE',bizStep:side,
   readPoint:{id:'urn:epc:id:sgln:0614141.00001.'+(side==='shipping'?'1':'2')},bizTransactionList:[{type:'desadv',bizTransaction:'urn:example:shipment:7'}],epcList:serials.map(pack)}]}};
}
