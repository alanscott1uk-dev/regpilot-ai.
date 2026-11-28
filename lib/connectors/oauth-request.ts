import {CollectionError} from './collection-error';
import {retryAfterSeconds} from './resilient-http';

/** Token POSTs are never blindly retried: refresh-token rotation can make a
 * repeated exchange unsafe. Temporary failures are deferred by the durable job. */
export async function requestOAuthToken(url:string,parameters:Record<string,string>,fetcher:typeof fetch,signal:AbortSignal){
 if(url!=='https://oauth2.googleapis.com/token'&&!/^https:\/\/login\.microsoftonline\.com\/[a-f0-9-]{36}\/oauth2\/v2\.0\/token$/i.test(url))throw new CollectionError('INVALID_AUTH_TARGET');
 let response:Response;
 try{response=await fetcher(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(parameters).toString(),cache:'no-store',redirect:'error',signal});}
 catch{throw new CollectionError(signal.aborted?'PROVIDER_TIMEOUT':'PROVIDER_UNAVAILABLE');}
 if(response.url&&response.url!==url){await response.body?.cancel();throw new CollectionError('TARGET_MISMATCH');}
 if(response.ok)return response;
 const retry=retryAfterSeconds(response.headers);
 await response.body?.cancel();
 if(retry!==null&&retry>7*86400)throw new CollectionError('RETRY_REQUIRES_REVIEW');
 if(response.status===429||retry!==null&&[403,500,502,503,504].includes(response.status))throw new CollectionError('RATE_LIMITED',retry??60);
 if([500,502,503,504].includes(response.status))throw new CollectionError('PROVIDER_UNAVAILABLE');
 throw new CollectionError([400,401,403].includes(response.status)?'CREDENTIAL_REJECTED':'AUTH_UNAVAILABLE');
}
