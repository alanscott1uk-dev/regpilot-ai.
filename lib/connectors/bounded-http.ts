import {CollectionError, type ConnectorCheck} from "./github";

/** Provider adapters supply fixed HTTPS origins; callers never supply request URLs. */
export function providerReader(fetcher:typeof fetch,headers:Record<string,string>,timeoutMs=25000){
 const signal=AbortSignal.timeout(timeoutMs);let total=0,calls=0;
 return async(url:string,optional=false):Promise<{body:any;headers:Headers}|null>=>{
  if(++calls>12)throw new CollectionError("REQUEST_LIMIT");
  let response:Response;
  try{response=await fetcher(url,{method:"GET",headers:{Accept:"application/json",...headers},redirect:"error",cache:"no-store",signal});}
  catch{throw new CollectionError("PROVIDER_UNAVAILABLE");}
  if(response.url&&response.url!==url){await response.body?.cancel();throw new CollectionError("TARGET_MISMATCH");}
  if(!response.ok){await response.body?.cancel();if(optional&&[403,404].includes(response.status))return null;throw new CollectionError(response.status===401?"CREDENTIAL_REJECTED":[403,429].includes(response.status)?"ACCESS_OR_RATE_LIMIT":"PROVIDER_UNAVAILABLE");}
  if(!response.headers.get("content-type")?.toLowerCase().includes("json")){await response.body?.cancel();throw new CollectionError("INVALID_RESPONSE");}
  const reader=response.body?.getReader();if(!reader)throw new CollectionError("EMPTY_RESPONSE");const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;total+=value.length;if(size>262144||total>1048576)throw new CollectionError("RESPONSE_TOO_LARGE");chunks.push(value);}return {body:JSON.parse(Buffer.concat(chunks).toString("utf8")),headers:response.headers};}
  catch(e){if(e instanceof CollectionError)throw e;throw new CollectionError("INVALID_RESPONSE");}
  finally{await reader.cancel().catch(()=>{});}
 };
}
export const validCredential=(token:string)=>typeof token==="string"&&token.length>=16&&token.length<=512&&!/[\s\x00-\x1f\x7f]/.test(token);
export function booleanCheck(id:string,label:string,value:unknown,expected:boolean,nextStep:string):ConnectorCheck{return {id,label,status:typeof value!=="boolean"?"UNKNOWN":value===expected?"PASS":"FAIL",observed:typeof value==="boolean"?String(value):"Not established",nextStep};}
