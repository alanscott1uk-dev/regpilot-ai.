import {readOfficialIndex} from './official-indexes';
import {coverageSample,measureCoverage} from './coverage-sample';
import type {HorizonReport} from './model';
import {weeklyDeviceCircular,scottishPharmaReason} from './watchlists';

const categories=[
 {id:'medicines-recall-notification',label:'Medicines recall or defect notice',expected:'Medicines review'},
 {id:'field-safety-notices',label:'Field safety notice',expected:'Device circular list'}
] as const;
const method='Compare the medicines-only shortlist with up to 30 entries from each MHRA category index on fully observed UTC days. Each published URL counts once.';

export async function compareMedicineAlertRouting(report:HorizonReport,fetcher:typeof fetch=fetch,now=Date.now()){
 const items=new Map(report.items.map(item=>[item.url,item]));
 const indexes=await Promise.all(categories.map(async category=>{
  const url='https://www.gov.uk/drug-device-alerts.atom?'+new URLSearchParams({'alert_type[]':category.id});
  try{
   const source=await readOfficialIndex({url,section:'drug-device-alerts',name:category.label,publisher:'mhra'},fetcher);
   const eligible=[...source.references].filter(([,on])=>on>report.windowStart.slice(0,10)&&on<report.generatedAt.slice(0,10));
   const entries=eligible.slice(0,30).map(([url,on])=>({url,on}));
   const coverage=entries.length?measureCoverage(coverageSample.parse({publisher:'mhra',title:category.label,method,entries}),report,now):null;
   const rows=(coverage?.rows??[]).map(row=>{
    const item=row.outcome==='FOUND'?items.get(row.url):undefined;
    const legacy=Boolean(item&&scottishPharmaReason(item));
    const destination=row.outcome==='INDETERMINATE'?'Unavailable':!item?'Missing':scottishPharmaReason(item,'scottish-medicines-only')?'Medicines review':weeklyDeviceCircular(item)?'Device circular list':'Other publications';
    return {title:source.titles.get(row.url)??row.url,url:row.url,on:row.on,expected:category.expected,destination,broadView:legacy,collection:row.outcome,revision:row.revision};
   });
   return {category:category.id,label:category.label,url,sha256:source.sha256,state:'READ',offered:source.offered,eligible:eligible.length,unrecognised:source.unrecognised,rows};
  }catch{return {category:category.id,label:category.label,url,sha256:null,state:'UNAVAILABLE',offered:null,eligible:null,unrecognised:null,rows:[]};}
 }));
 const claims=indexes.flatMap(index=>index.rows),frequencies=new Map<string,number>();
 for(const claim of claims)frequencies.set(claim.url,(frequencies.get(claim.url)??0)+1);
 const ambiguous=new Set(claims.filter(row=>frequencies.get(row.url)!>1).map(row=>row.url));
 const rows=claims.filter(row=>!ambiguous.has(row.url)),comparable=rows.filter(row=>row.destination!=='Unavailable');
 const medicines=comparable.filter(row=>row.expected==='Medicines review'),devices=comparable.filter(row=>row.expected==='Device circular list');
 const complete=indexes.every(index=>index.state==='READ'&&index.unrecognised===0);
 return {method,snapshot:report.generatedAt,revision:report.codeCommit,checkedAt:new Date(now).toISOString(),indexes,ambiguous:[...ambiguous],unavailable:rows.length-comparable.length,
  counts:complete&&comparable.length?{medicines:medicines.length,kept:medicines.filter(r=>r.destination==='Medicines review').length,devices:devices.length,
   listedSeparately:devices.filter(r=>r.destination==='Device circular list').length,devicesInBroadView:devices.filter(r=>r.broadView).length,devicesInMedicinesView:devices.filter(r=>r.destination==='Medicines review').length,
   missing:comparable.filter(r=>r.destination==='Missing').length}:null};
}
