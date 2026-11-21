import {z} from "zod";
import {requestOAuthToken} from "./oauth-request";
import {readBoundedJson as json} from "./bounded-http";
import {resilientGet} from "./resilient-http";
import {CollectionError} from "./collection-error";

export const GRAPH = "https://graph.microsoft.com";
export const microsoftTarget = z.object({tenantId:z.uuid(),clientId:z.uuid()});
export type MicrosoftTarget = z.infer<typeof microsoftTarget>;

export async function verifiedMicrosoftGraph(target:MicrosoftTarget, secret:string, fetcher:typeof fetch, readHeaders:Record<string,string>={}) {
 const t=microsoftTarget.parse(target),started=Date.now(),signal=AbortSignal.timeout(25000);
 const auth=await requestOAuthToken("https://login.microsoftonline.com/"+t.tenantId+"/oauth2/v2.0/token",{client_id:t.clientId,client_secret:secret,scope:GRAPH+"/.default",grant_type:"client_credentials"},fetcher,signal);
 const token=await json(auth,20000);if(typeof token?.access_token!=="string"||token.access_token.length<10||token.access_token.length>16000||/[\r\n]/.test(token.access_token)||String(token.token_type).toLowerCase()!=="bearer")throw new CollectionError("INVALID_AUTH_RESPONSE");
 const read=resilientGet(fetcher,GRAPH,{...readHeaders,Authorization:'Bearer '+token.access_token,Accept:'application/json'},{timeoutMs:Math.max(1,25000-(Date.now()-started)),maxRequests:32});
 const get=async(url:string)=>{const response=await read(url);if(response.status===401){await response.body?.cancel();throw new CollectionError("CREDENTIAL_REJECTED");}return response;};
 const org=await get(GRAPH+"/v1.0/organization?$select=id");if(!org.ok){await org.body?.cancel();throw new CollectionError("TENANT_VERIFICATION_FAILED");}
 const organisation=await json(org,20000);if(!Array.isArray(organisation?.value)||organisation.value.length!==1||String(organisation.value[0]?.id).toLowerCase()!==t.tenantId.toLowerCase())throw new CollectionError("TARGET_MISMATCH");
 return get;
}
