import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {verifyWebhook,webhookEvent,readWebhookBytes,WebhookError} from '../lib/connectors/webhook-signature';
import {POST} from '../app/api/integrations/webhooks/[provider]/[id]/route';
import {POST as configure} from '../app/api/workspace/connectors/[id]/webhook/route';
const body=Buffer.from(JSON.stringify({repository:{full_name:'synthetic/project'},ref:'refs/heads/main'})),secret='a'.repeat(64);
function github(bytes=body){return new Headers({'x-github-delivery':randomUUID(),'x-github-event':'push','x-hub-signature-256':'sha256='+createHmac('sha256',secret).update(bytes).digest('hex')});}
test('GitHub webhook integrity uses raw bytes and SHA256; delivery identifiers never replace authentication',()=>{
 const headers=github(),valid=verifyWebhook('GITHUB',secret,headers,body);
 assert.equal(valid.deliveryId,headers.get('x-github-delivery'));assert.equal(valid.payloadHash.length,64);
 assert.throws(()=>verifyWebhook('GITHUB',secret,headers,Buffer.concat([body,Buffer.from(' ')])),WebhookError);
 assert.throws(()=>verifyWebhook('GITHUB','b'.repeat(64),headers,body),WebhookError);
 headers.set('x-hub-signature','sha1='+ 'a'.repeat(40));headers.delete('x-hub-signature-256');
 assert.throws(()=>verifyWebhook('GITHUB',secret,headers,body),WebhookError);
 const altered=github();const first=verifyWebhook('GITHUB',secret,altered,body);altered.set('x-github-delivery',randomUUID());
 assert.equal(verifyWebhook('GITHUB',secret,altered,body).payloadHash,first.payloadHash,'payload digest supports deduplication even when unsigned delivery ID changes');
});
test('GitLab signed messages bind ID, timestamp and payload, reject stale/future messages and never fall back to plain tokens',()=>{
 const raw=randomBytes(32),key='whsec_'+raw.toString('base64'),id=randomUUID(),now=Date.now(),timestamp=String(Math.floor(now/1000));
 const signature='v1,'+createHmac('sha256',raw).update(id+'.'+timestamp+'.').update(body).digest('base64');
 const headers=new Headers({'webhook-id':id,'webhook-timestamp':timestamp,'webhook-signature':'v1,'+'A'.repeat(43)+'= '+signature});
 assert.equal(verifyWebhook('GITLAB',key,headers,body,now).deliveryId,id);
 for(const drift of [-301000,301000])assert.throws(()=>verifyWebhook('GITLAB',key,headers,body,now+drift),WebhookError);
 headers.set('webhook-id',randomUUID());assert.throws(()=>verifyWebhook('GITLAB',key,headers,body,now),WebhookError);
 headers.set('webhook-id',id);headers.delete('webhook-signature');headers.set('x-gitlab-token',key);
 assert.throws(()=>verifyWebhook('GITLAB',key,headers,body,now),WebhookError);
});
test('event routing binds repository and branch and ignores unrelated event types',()=>{
 assert.equal(webhookEvent('GITHUB',github(),body,{repository:'synthetic/project',branch:'main'}),'push');
 assert.equal(webhookEvent('GITHUB',github(),body,{repository:'synthetic/project',branch:'other'}),null);
 assert.throws(()=>webhookEvent('GITHUB',github(),body,{repository:'outside/project',branch:'main'}),(e:any)=>e.status===403);
 const event=Buffer.from(JSON.stringify({project:{path_with_namespace:'synthetic/project'},object_kind:'merge_request',object_attributes:{target_branch:'main'}}));
 assert.equal(webhookEvent('GITLAB',new Headers({'x-gitlab-event':'Merge Request Hook'}),event,{repository:'gitlab:synthetic/project',branch:'main'}),'merge_request');
 assert.equal(webhookEvent('GITLAB',new Headers({'x-gitlab-event':'Push Hook'}),event,{repository:'gitlab:synthetic/project',branch:'main'}),null);
 assert.throws(()=>webhookEvent('GITHUB',github(),new Uint8Array([255]),{repository:'synthetic/project',branch:'main'}));
});
test('webhook byte reader enforces content type, declared length and streaming size caps',async()=>{
 const request=(value:string,headers:Record<string,string>={})=>new Request('https://fixture.invalid',{method:'POST',body:value,headers:{'content-type':'application/json',...headers}});
 assert.deepEqual(await readWebhookBytes(request(body.toString())),body);
 await assert.rejects(()=>readWebhookBytes(request('{}',{'content-length':'262145'})),(e:any)=>e.status===413);
 await assert.rejects(()=>readWebhookBytes(request(' '.repeat(262145))),(e:any)=>e.status===413);
 await assert.rejects(()=>readWebhookBytes(request('{}',{'content-encoding':'gzip'})),(e:any)=>e.status===415);
});
test('event ingress defaults off and configuration authenticates before accepting a secret',async()=>{
 const previous=process.env.REGPILOT_WEBHOOKS_ENABLED;process.env.REGPILOT_WEBHOOKS_ENABLED='false';
 try{
  const result=await POST(new Request('https://fixture.invalid',{method:'POST'}),{params:Promise.resolve({provider:'github',id:randomUUID()})});assert.equal(result.status,503);
  const admin=await configure(new Request('https://fixture.invalid?organizationId='+randomUUID(),{method:'POST',body:'not-json'}),{params:Promise.resolve({id:randomUUID()})});assert.ok([401,503].includes(admin.status));
 }finally{if(previous===undefined)delete process.env.REGPILOT_WEBHOOKS_ENABLED;else process.env.REGPILOT_WEBHOOKS_ENABLED=previous;}
});
