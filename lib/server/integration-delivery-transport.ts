import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {lookup as dnsLookup} from 'node:dns/promises';
import {request as httpsRequest,type RequestOptions} from 'node:https';
import type {ClientRequest,IncomingMessage} from 'node:http';
import {isIP,BlockList} from 'node:net';
import {DELIVERY_LIMITS,validDeliveryUrl} from '../integration-delivery';

export class DeliveryTransportError extends Error{constructor(public code:string,public retryable=false){super(code);}}
export const newDeliverySecret=()=> 'rpd_'+randomBytes(32).toString('base64url');
export function deliverySignature(secret:string,deliveryId:string,timestamp:string,body:string){
 if(!/^rpd_[A-Za-z0-9_-]{43}$/.test(secret))throw new DeliveryTransportError('SIGNING_SECRET_INVALID');
 return 'v1='+createHmac('sha256',Buffer.from(secret.slice(4),'base64url')).update(deliveryId+'.'+timestamp+'.'+body).digest('hex');
}
/** Receiver reference implementation. Verify raw bytes before JSON parsing and
 * deduplicate the stable delivery ID transactionally in the receiving system. */
export function verifyDeliverySignature(input:{secret:string;deliveryId:string;timestamp:string;body:string;signature:string;now?:number}){
 if(!/^[0-9]{10,11}$/.test(input.timestamp)||Math.abs((input.now??Date.now())/1000-Number(input.timestamp))>300||!/^v1=[a-f0-9]{64}$/.test(input.signature))return false;
 try{const expected=Buffer.from(deliverySignature(input.secret,input.deliveryId,input.timestamp,input.body));const actual=Buffer.from(input.signature);return expected.length===actual.length&&timingSafeEqual(expected,actual);}catch{return false;}
}
const blocked=new BlockList();
for(const [address,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]] as const)blocked.addSubnet(address,prefix,'ipv4');
export const publicDeliveryAddress=(value:string)=>isIP(value)===4&&!blocked.check(value,'ipv4');
export type DeliveryTransportDependencies={
 resolve?:(hostname:string)=>Promise<Array<{address:string;family:number}>>;
 beforeSend?:()=>Promise<void>;
 /** Injection is for controlled local receivers in tests. There is no runtime
  * URL allowlist override or environment option that permits private targets. */
 request?:(options:RequestOptions,callback:(response:IncomingMessage)=>void)=>ClientRequest;
};
export type DeliveryTransportResult={status:number;durationMs:number;responseBytes:number;peerAddressHash:string;retryAfterSeconds:number;challenge:string|null};
async function resolvePublic(hostname:string,resolve:NonNullable<DeliveryTransportDependencies['resolve']>){
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  const addresses=await Promise.race([resolve(hostname),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new DeliveryTransportError('DNS_TIMEOUT',true)),2000);})]);
  if(!addresses.length||addresses.length>32)throw new DeliveryTransportError('DNS_ANSWER_UNAVAILABLE',true);
  // This first transport is IPv4-only. No unvalidated IPv6 address can be selected.
  const ipv4=addresses.filter(row=>row.family===4);
  if(!ipv4.length)throw new DeliveryTransportError('IPV4_REQUIRED');
  if(ipv4.some(row=>!publicDeliveryAddress(row.address)))throw new DeliveryTransportError('DESTINATION_BLOCKED');
  return ipv4[0].address;
 }catch(error){if(error instanceof DeliveryTransportError)throw error;throw new DeliveryTransportError('DNS_FAILED',true);}finally{if(timer)clearTimeout(timer);}
}
export async function sendIntegrationDelivery(input:{url:string;body:string;secret:string;eventId:string;deliveryId:string;attemptId:string},deps:DeliveryTransportDependencies={}):Promise<DeliveryTransportResult>{
 if(!validDeliveryUrl(input.url))throw new DeliveryTransportError('DESTINATION_INVALID');
 const bytes=Buffer.byteLength(input.body);if(bytes>DELIVERY_LIMITS.requestBytes)throw new DeliveryTransportError('PAYLOAD_TOO_LARGE');
 const started=Date.now(),url=new URL(input.url),address=await resolvePublic(url.hostname,deps.resolve??(hostname=>dnsLookup(hostname,{all:true,verbatim:true}))),timestamp=String(Math.floor(Date.now()/1000));
 await deps.beforeSend?.();
 if(Date.now()-started>=DELIVERY_LIMITS.requestMs)throw new DeliveryTransportError('REQUEST_TIMEOUT',true);
 return new Promise((resolve,reject)=>{
  let complete=false,req:ClientRequest|undefined,timer:ReturnType<typeof setTimeout>|undefined;
  const fail=(code:string,retryable=false)=>{if(complete)return;complete=true;if(timer)clearTimeout(timer);req?.destroy();reject(new DeliveryTransportError(code,retryable));};
  try{
   req=(deps.request??httpsRequest)({protocol:'https:',hostname:url.hostname,port:443,path:url.pathname,method:'POST',servername:url.hostname,rejectUnauthorized:true,agent:false,maxHeaderSize:8192,family:4,
    lookup:(_hostname,_options,callback)=>callback(null,address,4),
    headers:{'Content-Type':'application/json','Content-Length':String(bytes),'User-Agent':'RegPilot-Delivery/1','RegPilot-Event-Id':input.eventId,'RegPilot-Delivery-Id':input.deliveryId,'RegPilot-Attempt-Id':input.attemptId,'RegPilot-Timestamp':timestamp,'RegPilot-Signature':deliverySignature(input.secret,input.deliveryId,timestamp,input.body)}
   },response=>{
    const status=response.statusCode||0;let size=0;const chunks:Buffer[]=[];
    response.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>DELIVERY_LIMITS.responseBytes){fail('RESPONSE_TOO_LARGE');response.destroy();}else chunks.push(chunk);});
    response.on('aborted',()=>fail('RESPONSE_INTERRUPTED',true));response.on('error',()=>fail('RESPONSE_FAILED',true));
    response.on('end',()=>{
     if(complete)return;complete=true;if(timer)clearTimeout(timer);
     const retryValue=Array.isArray(response.headers['retry-after'])?'':response.headers['retry-after']||'',retryAfterSeconds=/^\d{1,6}$/.test(retryValue)?Math.min(86400,Number(retryValue)):0;
     let challenge:string|null=null;try{const value:unknown=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(value&&typeof value==='object'&&'challenge'in value&&typeof value.challenge==='string'&&/^[a-f0-9]{64}$/.test(value.challenge))challenge=value.challenge;}catch{/* Response bodies are never retained. */}
     resolve({status,durationMs:Math.max(0,Date.now()-started),responseBytes:size,peerAddressHash:createHash('sha256').update(address).digest('hex'),retryAfterSeconds,challenge});
    });
   });
   timer=setTimeout(()=>fail('REQUEST_TIMEOUT',true),Math.max(1,DELIVERY_LIMITS.requestMs-(Date.now()-started)));
   req.on('error',(error:NodeJS.ErrnoException)=>fail(['CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT','ERR_TLS_CERT_ALTNAME_INVALID','UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(error.code||'')?'TLS_VERIFICATION_FAILED':'NETWORK_FAILED',!['CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT','ERR_TLS_CERT_ALTNAME_INVALID','UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(error.code||'')));
   req.end(input.body);
  }catch{fail('TRANSPORT_FAILED',true);}
 });
}
