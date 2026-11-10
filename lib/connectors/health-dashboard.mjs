// Only observable, checkable connector signals; no inferred control or legal compliance.
const time=s=>s&&Number.isFinite(Date.parse(s))?Date.parse(s):null;
export function connectorHealth(rows, now=Date.now()){
 const items=(Array.isArray(rows)?rows:[]).filter(x=>x&&typeof x.id==="string"&&typeof x.provider==="string").map(x=>{
  const last=time(x.lastSuccessAt),captured=time(x.lastCapturedAt);
  const interval=x.intervalHours===168?168:24;
  const delay=(interval+2)*3600000;
  const currentVersion=x.version===x.observedVersion;
  let status,reason;
  if(x.failureCode){status="failed";reason="Collection failed; earlier data must not be relied on";}
  else if(!x.enabled){status="paused";reason="Connection is disabled";}
  else if(x.providerAvailable===false){status="unavailable";reason="Provider is not enabled or available in this workspace";}
  else if(!last||!captured){status="never-verified";reason="No successfully stored collection exists";}
  else if(x.integrityValid===false||!currentVersion){status="untrusted";reason="Last recorded observation failed integrity or current-version checks";}
  else if(now-last>delay||now-captured>delay){status="stale";reason="Last verified collection exceeds the configured interval";}
  else if(x.lastOutcome!=="OBSERVED"){status="attention";reason="Observed settings include failing or unknown checks that need human attention";}
  else{status="observed";reason="Recently retrieved and integrity-checked settings; no compliance conclusion";}
  return {id:x.id,provider:x.provider,target:String(x.target||"").slice(0,220),
   lastSuccessAt:x.lastSuccessAt||null,status,reason,checksFailed:Number(x.checksFailed)||0,checksUnknown:Number(x.checksUnknown)||0,
   observedVersion:x.observedVersion||null,version:x.version||null,intervalHours:interval,
   href:"/team/operations?view=connections"};
 });
 const counts=Object.fromEntries(["observed","attention","failed","paused","unavailable","never-verified","untrusted","stale"].map(k=>[k,items.filter(x=>x.status===k).length]));
 return {items:items.sort((a,b)=>a.status.localeCompare(b.status)||a.provider.localeCompare(b.provider)),
   total:items.length,observed:counts.observed||0,needsAttention:items.filter(x=>!["observed","paused"].includes(x.status)).length,
   counts,notice:"A successful connection is a point-in-time technical observation, not evidence that a control is legally sufficient."};
}
