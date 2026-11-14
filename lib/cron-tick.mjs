/** Bounded independent background workflows. A failure in one must not silently suppress others. */
export async function executeScheduledTick(work){
 const kinds=["sources","connectors","controlReviews"];
 const results=await Promise.allSettled(kinds.map(async k=>work[k]?await work[k]():{processed:0,disabled:true}));
 const attentionStates=new Set(["FAILED","ATTENTION","RETRY_SCHEDULED","INCOMPLETE","FOLLOW_UP","RECOVERY_BACKLOG"]);
 const modules=Object.fromEntries(results.map((item,i)=>{
  if(item.status!=="fulfilled")return [kinds[i],{state:"failed",processed:0,attention:1}];
  const value=item.value||{},outcomes=Array.isArray(value.outcomes)?value.outcomes:[];
  const attention=outcomes.filter(s=>attentionStates.has(s)).length+
    (Number.isSafeInteger(value.attention)&&value.attention>0?value.attention:0);
  const state=value.disabled?"disabled":attention?"attention":value.limitReached||value.budgetExhausted||outcomes.includes("PROVIDER_DEFERRED")?"backlog":"completed";
  return [kinds[i],{state,processed:Number.isSafeInteger(value.processed)?value.processed:0,
   outcomeCount:outcomes.length,attention}];
 }));
 return {ok:results.every(x=>x.status==="fulfilled")&&Object.values(modules).every(m=>m.state!=="attention"),modules};
}
export function validCronSecret(header,secret){
 if(typeof secret!=="string"||secret.length<32||secret.length>256||typeof header!=="string"||header.length>300)return false;
 const a=Buffer.from(header),b=Buffer.from("Bearer "+secret);
 return a.length===b.length&&requireConstantTimeEqual(a,b);
}
function requireConstantTimeEqual(a,b){
 // Caller checks equal lengths; compare every byte without timing-dependent branches.
 let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;
}
