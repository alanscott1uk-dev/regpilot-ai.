import {z} from "zod";
import {CollectionError,type ConnectorCheck} from "./github";
import type {Observation} from "./observation";
import {providerReader,validCredential} from "./bounded-http";
export const cloudflareTarget=z.object({zoneId:z.string().regex(/^[a-f0-9]{32}$/i),accountId:z.string().regex(/^[a-f0-9]{32}$/i)});
export async function collectCloudflare(target:z.infer<typeof cloudflareTarget>,token:string,fetcher:typeof fetch=fetch):Promise<Observation>{
 const parsed=cloudflareTarget.safeParse(target);if(!parsed.success||!validCredential(token))throw new CollectionError("INVALID_TARGET");const t=parsed.data,get=providerReader(fetcher,{Authorization:"Bearer "+token}),base="https://api.cloudflare.com/client/v4/zones/"+t.zoneId.toLowerCase();
 const zone=(await get(base))!.body;if(zone?.success!==true||zone.result?.id!==t.zoneId.toLowerCase()||zone.result?.account?.id!==t.accountId.toLowerCase())throw new CollectionError("TARGET_MISMATCH");
 const settings=[{id:"ssl",label:"Origin TLS uses strict certificate validation",allowed:["off","flexible","full","strict"],pass:["strict"]},{id:"min_tls_version",label:"Edge minimum TLS is 1.2 or newer",allowed:["1.0","1.1","1.2","1.3"],pass:["1.2","1.3"]},{id:"always_use_https",label:"HTTP redirects to HTTPS",allowed:["on","off"],pass:["on"]},{id:"tls_1_3",label:"TLS 1.3 is enabled",allowed:["on","off","zrt"],pass:["on","zrt"]}];
 const checks:ConnectorCheck[]=[];
 for(const s of settings){const response=await get(base+"/settings/"+s.id,true),body=response?.body;let value:unknown;
  if(response){if(body?.success!==true||body.result?.id!==s.id)throw new CollectionError("INVALID_RESPONSE");value=body.result.value;}
  const known=typeof value==="string"&&s.allowed.includes(value);checks.push({id:s.id,label:s.label,status:!known?"UNKNOWN":s.pass.includes(value as string)?"PASS":"FAIL",observed:known?value as string:"Not established",nextStep:"Inspect this zone setting, exceptions and actual TLS behaviour before changing configuration."});
 }
 return {engine:"cloudflare-zone-1.0.0",sourceUrl:"https://dash.cloudflare.com/"+t.accountId.toLowerCase(),capturedAt:new Date().toISOString(),checks,limitations:["Read-only settings for one verified Cloudflare account/zone. No DNS records, traffic, requests or customer identities are collected.","Settings do not prove actual certificate validity, origin configuration, WAF effectiveness, per-host overrides or compliance. Missing/unsupported settings remain unknown."]};
}
