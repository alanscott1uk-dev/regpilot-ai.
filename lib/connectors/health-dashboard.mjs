import {supportsHourlyMonitoring} from './hourly-schedule.mjs';
// Only observable, checkable connector signals; no inferred control or legal compliance.
const time=s=>s&&Number.isFinite(Date.parse(s))?Date.parse(s):null;
export function connectorHealth(rows, now=Date.now()){
 const items=(Array.isArray(rows)?rows:[]).filter(x=>x&&typeof x.id==="string"&&typeof x.provider==="string").map(x=>{
  const last=time(x.lastSuccessAt),captured=time(x.lastCapturedAt);
  const source=time(x.sourceCapturedAt??x.lastCapturedAt);
  const hourly=x.intervalHours===1&&supportsHourlyMonitoring(x.provider);
  const interval=hourly?1:x.intervalHours===168?168:24;
  const delay=interval*3600000;
  const currentVersion=x.version===x.observedVersion;
  let status,reason;
  if(["CREDENTIAL_REJECTED","PERMISSION_REVOKED"].includes(x.failureCode)){status="revoked";reason="Access was rejected. Restore the grant and collect fresh evidence.";}
  else if(x.failureCode){status="failed";reason="Collection failed; earlier data must not be relied on";}
  else if(!x.enabled){status="paused";reason="Connection is disabled";}
  else if(x.providerAvailable===false){status="unavailable";reason="Provider is not enabled or available in this workspace";}
  else if(!last||!captured){status="never-verified";reason="No successfully stored collection exists";}
  else if(x.integrityValid!==true||!currentVersion||!source||source>now||last>now||captured>now||(!hourly&&![24,168].includes(x.intervalHours))){status="untrusted";reason="Last recorded observation failed integrity or current-version checks";}
  else if(x.expiredSample){status="stale";reason="Check the instrument timestamp, current certificate and maximum sample age";}
  else if(now-source>=delay||now-last>=delay||now-captured>=delay){status="stale";reason="Last verified collection exceeds the configured interval";}
  else if(x.pendingEvent||x.lastOutcome==="INCOMPLETE"){status="incomplete";reason=x.pendingEvent?"A provider event is awaiting collection.":"Part of the collection is unknown. Inspect the missing checks."; }
  else if(x.lastOutcome!=="OBSERVED"){status="attention";reason="Observed settings include failing or unknown checks that need human attention";}
  else{status="observed";reason="Recently retrieved and integrity-checked settings; no compliance conclusion";}
  return {id:x.id,provider:x.provider,target:String(x.target||"").slice(0,220),
   owner:x.owner||null,sourceUrl:x.sourceUrl||null,sourceCapturedAt:x.sourceCapturedAt||null,expiresAt:source&&captured?new Date(Math.min(source,captured)+delay).toISOString():null,
   runId:x.runId||null,resultHash:x.resultHash||null,checksSeen:x.checksSeen||0,findings:x.findings||[],history:x.history||[],openTasks:x.openTasks||[],scope:x.scope||null,
   lastSuccessAt:x.lastSuccessAt||null,status,reason,checksFailed:Number(x.checksFailed)||0,checksUnknown:Number(x.checksUnknown)||0,
   controls:Array.isArray(x.controls)?x.controls:[],
   observedVersion:x.observedVersion||null,version:x.version||null,intervalHours:interval,
   href:"/team/operations?view=connections#connection-"+encodeURIComponent(x.id)};
 });
 const counts=Object.fromEntries(["observed","incomplete","revoked","attention","failed","paused","unavailable","never-verified","untrusted","stale"].map(k=>[k,items.filter(x=>x.status===k).length]));
 return {items:items.sort((a,b)=>a.status.localeCompare(b.status)||a.provider.localeCompare(b.provider)),
   total:items.length,observed:counts.observed||0,needsAttention:items.filter(x=>!["observed","paused"].includes(x.status)).length,
   counts,notice:"A successful connection is a point-in-time technical observation, not evidence that a control is legally sufficient."};
}
