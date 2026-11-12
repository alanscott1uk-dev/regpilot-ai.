import {CollectionError} from './collection-error';
export type ReadMetrics={requests:number;retries:number};
export function retryAfterSeconds(headers:Headers,now=Date.now()):number|null{
 const value=headers.get('retry-after');
 if(value!==null){const seconds=/^\d+$/.test(value)?Number(value):Math.ceil((Date.parse(value)-now)/1000);if(Number.isFinite(seconds)&&seconds>=0)return Math.min(Number.MAX_SAFE_INTEGER,Math.max(1,seconds));}
 const reset=headers.get('x-ratelimit-reset');
 if(headers.get('x-ratelimit-remaining')==='0'&&reset&&/^\d+$/.test(reset))return Math.min(Number.MAX_SAFE_INTEGER,Math.max(1,Math.ceil(Number(reset)-now/1000)));
 return null;
}
/** Retries only idempotent reads on a fixed HTTPS origin. One shared deadline and
 * request budget applies to the complete adapter, including retry attempts. */
export function resilientGet(fetcher:typeof fetch,origin:string,headers:Record<string,string>,options:{timeoutMs?:number;maxRequests?:number;metrics?:ReadMetrics;clock?:()=>number;sleep?:(ms:number)=>Promise<void>;random?:()=>number}={}){
 const clock=options.clock||Date.now,deadline=clock()+(options.timeoutMs??25000),metrics=options.metrics||{requests:0,retries:0};
 const sleep=options.sleep||((ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms))),random=options.random||Math.random;
 if(new URL(origin).origin!==origin||!origin.startsWith('https://'))throw new CollectionError('INVALID_ORIGIN');
 return async(url:string):Promise<Response>=>{
  const target=new URL(url);if(target.origin!==origin||target.username||target.password||target.hash)throw new CollectionError('UNSAFE_TARGET');
  for(let attempt=0;attempt<3;attempt++){
   if(clock()>=deadline)throw new CollectionError('PROVIDER_TIMEOUT');
   if(metrics.requests>=(options.maxRequests??18))throw new CollectionError('REQUEST_LIMIT');metrics.requests++;
   let response:Response|undefined;
   try{response=await fetcher(url,{method:'GET',headers,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(Math.max(1,deadline-clock()))});}catch{}
   if(response?.url&&response.url!==url){await response.body?.cancel();throw new CollectionError('TARGET_MISMATCH');}
   const rateLimited=response?.status===429||response?.status===403&&(response.headers.has('retry-after')||response.headers.get('x-ratelimit-remaining')==='0');
   const transient=!response||[502,503,504].includes(response.status)||rateLimited;
   if(!transient)return response!;
   const instructed=response?retryAfterSeconds(response.headers,clock()):null;
   await response?.body?.cancel();
   if(instructed!==null&&instructed>7*86400)throw new CollectionError('RETRY_REQUIRES_REVIEW');
   const delay=instructed!==null?instructed*1000:Math.round(250*2**attempt+random()*150);
   // Never shorten Retry-After to fit a request. Persist long waits in the job schedule.
   const cooldown=rateLimited||instructed!==null;
   if(attempt===2||delay>2000||clock()+delay+1000>=deadline)throw new CollectionError(cooldown?'RATE_LIMITED':'PROVIDER_UNAVAILABLE',cooldown?instructed??60:undefined);
   metrics.retries++;await sleep(delay);
  }
  throw new CollectionError('PROVIDER_UNAVAILABLE');
 };
}
