/** History contains hashes and availability only, never credentials or legal verdicts.
 * Cache eviction/reset is explicit: a missing baseline is not an unchanged source. */
export function compareProbeHistory(results,previous,checkedAt){
 const now=Date.parse(checkedAt);
 if(!Number.isFinite(now)||!Array.isArray(results)||results.length>300)throw Error("Invalid probe input");
 const validTime=x=>typeof x==="string"&&Number.isFinite(Date.parse(x))&&Date.parse(x)<=now;
 const validPrevious=previous?.format==="regpilot-source-history-v1"&&validTime(previous.checkedAt)&&Array.isArray(previous.sources)&&previous.sources.length<=300;
 const older=new Map(validPrevious?previous.sources.filter(x=>x&&typeof x.id==="string"&&typeof x.url==="string"&&/^https:\/\//.test(x.url)&&/^[a-f0-9]{64}$/.test(x.lastGoodHash)&&validTime(x.lastGoodAt)&&Number.isSafeInteger(x.failures)&&x.failures>=0&&x.failures<100000).map(x=>[x.id,x]):[]);
 const sources=[],changes=[];
 for(const row of results){
  const old=older.get(row.id),baseline=old?.url===row.url?old:null;
  const good=row.state==="text-retrieved"&&/^[a-f0-9]{64}$/.test(row.textHash||"");
  const state=!good?"UNAVAILABLE":!baseline?"BASELINE":baseline.lastGoodHash===row.textHash?"UNCHANGED":"CONTENT_CHANGED";
  changes.push({id:row.id,url:row.url,state,previousHash:baseline?.lastGoodHash||null,currentHash:good?row.textHash:null,
   comparedWith:baseline?.lastGoodAt||null,recoveredAfterOutage:!!good&&!!baseline?.failures,
   consecutiveFailures:good?0:Math.min((baseline?.failures||0)+1,99999)});
  if(good||baseline)sources.push({id:row.id,url:row.url,lastGoodHash:good?row.textHash:baseline.lastGoodHash,
   lastGoodAt:good?checkedAt:baseline.lastGoodAt,failures:good?0:Math.min((baseline?.failures||0)+1,99999)});
 }
 return {history:{format:"regpilot-source-history-v1",checkedAt,sources},
  comparison:{baselineAvailable:!!validPrevious,checkedAt,changes,
   counts:Object.fromEntries(["BASELINE","UNCHANGED","CONTENT_CHANGED","UNAVAILABLE"].map(state=>[state,changes.filter(x=>x.state===state).length])),
   limitation:"Hash changes identify different retrieved text, not changed law or applicability. Availability gaps and missing baselines remain explicit."}};
}
