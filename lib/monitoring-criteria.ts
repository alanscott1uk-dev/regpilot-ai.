type Check = {id:string; status:string};
type Read = {id:string; at:string; version:number; mode:string; checks:Check[]};

export function sameKnownChecks(left:Check[], right:Check[]) {
 const ids=new Set(left.map(check=>check.id));
 return left.length>0 && left.length===right.length && ids.size===left.length &&
  new Set(right.map(check=>check.id)).size===right.length &&
  left.every(check=>check.status!=='UNKNOWN') && right.every(check=>check.status!=='UNKNOWN' && ids.has(check.id));
}

export function scheduledEvidence(reads:Read[], version:number, intervalHours:number, now:number) {
 const unique=new Map<string,Read>();
 for(const read of reads)if(read.mode==='SCHEDULED' && read.version===version)unique.set(read.id,read);
 const scheduled=[...unique.values()].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
 const latest=scheduled[0], interval=intervalHours*3600000;
 const complete=scheduled.filter(read=>read.checks.length && read.checks.every(c=>c.status!=='UNKNOWN'));
 let pair:{older:string;newer:string}|null=null;
 if(latest && interval>0){
  const age=now-Date.parse(latest.at);
  if(age>=0 && age<interval){
   const previous=scheduled.slice(1).find(read=>{
    const gap=Date.parse(latest.at)-Date.parse(read.at);
    return gap>=interval-1000 && gap<=interval+30*60000 && sameKnownChecks(latest.checks,read.checks);
   });
   if(previous)pair={older:previous.id,newer:latest.id};
  }
 }
 return {scheduledReads:complete.length,latestScheduledAt:latest?.at??null,cadenceReceipts:pair,cadence:pair!==null};
}

export const monitoringGaps={
 product:'Identify a distinct monitored product',
 ownership:'Have a second administrator confirm customer ownership',
 current:'Collect a current qualifying source reading',
 repeat:'Retain two qualifying reads an interval apart',
 cadence:'Collect two scheduled readings on cadence for the same checks',
 rotation:'Verify reads on both sides of credential replacement',
 recovery:'Verify recovery from a recorded credential rejection',
 inference:'Record a successful generation with the linked account'
} as const;
export type MonitoringGap=keyof typeof monitoringGaps;
export function missingMonitoringEvidence(input:{
 productKey:string|null;category:string;current:boolean;repeat:boolean;rotated:boolean;cadence:boolean;recovered:boolean;inference:boolean|null
}):MonitoringGap[]{
 const requirements:Record<MonitoringGap,boolean>={
  product:!!input.productKey,ownership:input.category==='CUSTOMER',current:input.current,repeat:input.repeat,
  cadence:input.cadence,rotation:input.rotated,recovery:input.recovered,inference:input.inference!==false
 };
 return (Object.keys(requirements) as MonitoringGap[]).filter(key=>!requirements[key]);
}
