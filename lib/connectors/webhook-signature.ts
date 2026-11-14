import {createHmac,timingSafeEqual,createHash} from 'node:crypto';

export type WebhookProvider='GITHUB'|'GITLAB';
export class WebhookError extends Error{constructor(public status:number,message='Webhook rejected'){super(message);}}
const same=(a:string,b:string)=>a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function validWebhookSecret(provider:WebhookProvider,secret:string){
 return provider==='GITHUB'?/^[A-Za-z0-9_-]{32,128}$/.test(secret):/^whsec_[A-Za-z0-9+/]{43}=$/.test(secret)&&Buffer.from(secret.slice(6),'base64').length===32;
}
export function verifyWebhook(provider:WebhookProvider,secret:string,headers:Headers,body:Uint8Array,now=Date.now()){
 if(!validWebhookSecret(provider,secret))throw new WebhookError(401);
 const deliveryId=headers.get(provider==='GITHUB'?'x-github-delivery':'webhook-id')||'';
 if(!/^[A-Za-z0-9_-]{8,128}$/.test(deliveryId))throw new WebhookError(401);
 let valid=false;
 if(provider==='GITHUB'){
  const signature=headers.get('x-hub-signature-256')||'';
  valid=/^sha256=[a-f0-9]{64}$/.test(signature)&&same(signature,'sha256='+createHmac('sha256',secret).update(body).digest('hex'));
 }else{
  const timestamp=headers.get('webhook-timestamp')||'',signature=headers.get('webhook-signature')||'';
  if(!/^\d{10}$/.test(timestamp)||Math.abs(now/1000-Number(timestamp))>300||signature.length>1024)throw new WebhookError(401);
  const expected='v1,'+createHmac('sha256',Buffer.from(secret.slice(6),'base64')).update(deliveryId+'.'+timestamp+'.').update(body).digest('base64');
  valid=signature.split(' ').some(s=>/^v1,[A-Za-z0-9+/]{43}=$/.test(s)&&same(s,expected));
 }
 if(!valid)throw new WebhookError(401);
 return {deliveryId,payloadHash:createHash('sha256').update(body).digest('hex')};
}

export function webhookEvent(provider:WebhookProvider,headers:Headers,body:Uint8Array,target:{repository:string;branch:string}){
 let payload:any;try{payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));}catch{throw new WebhookError(400,'Invalid webhook JSON');}
 if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new WebhookError(400);
 if(provider==='GITHUB'){
  const event=headers.get('x-github-event')||'';
  if(payload.repository?.full_name!==target.repository)throw new WebhookError(403,'Webhook target mismatch');
  if(event==='ping')return null;
  if(event==='push')return payload.ref==='refs/heads/'+target.branch?'push':null;
  if(event==='pull_request')return payload.pull_request?.base?.ref===target.branch?'pull_request':null;
  if(['branch_protection_rule','repository_ruleset','repository','member','team_add','public','security_and_analysis'].includes(event))return event;
  return null;
 }
 if(payload.project?.path_with_namespace!==target.repository.replace(/^gitlab:/,''))throw new WebhookError(403,'Webhook target mismatch');
 const event=headers.get('x-gitlab-event')||'';
 if(event==='Push Hook'&&payload.object_kind==='push')return payload.ref==='refs/heads/'+target.branch?'push':null;
 if(event==='Merge Request Hook'&&payload.object_kind==='merge_request')return payload.object_attributes?.target_branch===target.branch?'merge_request':null;
 if(event==='Pipeline Hook'&&payload.object_kind==='pipeline')return payload.object_attributes?.ref===target.branch?'pipeline':null;
 return null;
}

export async function readWebhookBytes(request:Request,maxBytes=262144){
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json'||request.headers.has('content-encoding'))throw new WebhookError(415);
 const length=request.headers.get('content-length');
 if(length&&(!/^\d+$/.test(length)||Number(length)>maxBytes))throw new WebhookError(413);
 const reader=request.body?.getReader();if(!reader)throw new WebhookError(400);
 const chunks:Uint8Array[]=[];let size=0,timer:ReturnType<typeof setTimeout>|undefined;
 const expired=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new WebhookError(408)),5000);});
 try{
  while(true){const {done,value}=await Promise.race([reader.read(),expired]);if(done)break;size+=value.byteLength;if(size>maxBytes)throw new WebhookError(413);chunks.push(value);}
  return Buffer.concat(chunks);
 }catch(error){void reader.cancel().catch(()=>{});throw error;}finally{clearTimeout(timer);reader.releaseLock();}
}
