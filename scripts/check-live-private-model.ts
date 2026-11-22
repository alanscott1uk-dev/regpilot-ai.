import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {collectModelAccess} from '../lib/connectors/direct-model';
import {generateCustomerDraft} from '../lib/connectors/customer-model';

async function main(){
 const scope='models.regpilot.test',model='regpilot-test',local='http://127.0.0.1:8186';
 process.env.REGPILOT_PRIVATE_MODEL_HOST=scope;
 let permitted=randomBytes(32).toString('hex');
 // The private gateway requires a credential even for listing models. Every successful request is served by llama.cpp.
 const gateway=createServer(async(req,res)=>{
  if(req.headers.authorization!=='Bearer '+permitted){res.writeHead(401).end();return;}
  const path=req.url??'';
  if(!['/v1/models','/v1/chat/completions'].includes(path)){res.writeHead(404).end();return;}
  try{
   const chunks=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
   const upstream=await fetch(local+path,{method:req.method,headers:{'Content-Type':'application/json'},body:chunks.length?Buffer.concat(chunks):undefined});
   res.writeHead(upstream.status,{'Content-Type':'application/json'}).end(Buffer.from(await upstream.arrayBuffer()));
  }catch{res.writeHead(502).end();}
 });
 gateway.listen(0,'127.0.0.1');await once(gateway,'listening');
 const address=gateway.address();assert.ok(address&&typeof address==='object');
 const transport:typeof fetch=async(input,options)=>{
  const url=new URL(String(input));assert.equal(url.origin,'https://'+scope);
  const response=await fetch('http://127.0.0.1:'+address.port+url.pathname,options);
  return new Response(response.body,{status:response.status,headers:response.headers});
 };
 const access=(key:string)=>collectModelAccess('PRIVATE_AI_MODEL',{scope,record:model},key,transport);
 const infer=(key:string)=>generateCustomerDraft({transport:'direct',modelConnector:'PRIVATE_AI_MODEL',provider:'private',scope,model,connectionId:'staging',key},
  'Answer the synthetic test request in JSON.','Set the status to online.',{type:'object',properties:{status:{type:'string',enum:['online']}},required:['status'],additionalProperties:false},transport);
 try{
  const old=permitted,first=await access(old),baseline=await infer(old);
  assert.deepEqual(baseline.output,{status:'online'});assert.ok(baseline.usage.outputTokens>0);
  permitted=randomBytes(32).toString('hex');
  await assert.rejects(access(old));await assert.rejects(infer(old));
  const next=await access(permitted),renewed=await infer(permitted);
  assert.deepEqual(renewed.output,{status:'online'});assert.ok(renewed.usage.outputTokens>0);
  await writeFile('live-private-model.json',JSON.stringify({source:'Disposable RegPilot inference server',model:'SmolLM2-135M-Instruct-Q4_K_M',first,next,firstUsage:baseline.usage,renewedUsage:renewed.usage,revokedKeyRejected:true},null,2));
  console.log('Two authenticated inferences completed across key rotation. The retired credential was rejected for both list and inference.');
 }finally{gateway.closeAllConnections();gateway.close();}
}
main().catch(e=>{console.error('Private model verification failed:',e.code??e.message);process.exitCode=1;});
