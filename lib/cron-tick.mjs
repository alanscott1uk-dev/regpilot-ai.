/** Bounded independent background workflows. A failure in one must not silently suppress others. */
export async function executeScheduledTick(work){
 const kinds=["sources","connectors","controlReviews"];
 const results=await Promise.allSettled(kinds.map(async k=>work[k]?await work[k]():{processed:0,disabled:true}));
 const modules=Object.fromEntries(results.map((item,i)=>[kinds[i],item.status==="fulfilled"?{
   state:item.value.disabled?"disabled":"completed",
   processed:Number.isSafeInteger(item.value.processed)?item.value.processed:0,
   outcomeCount:Array.isArray(item.value.outcomes)?item.value.outcomes.length:undefined
 }:{state:"failed",processed:0}]));
 return {ok:results.every(x=>x.status==="fulfilled"),modules};
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
