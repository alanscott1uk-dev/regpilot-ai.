// Controlled TLS receiver for network contract tests and the private browser
// acceptance helper. Production dispatch never imports this fixture routing.
import {createServer,request as httpsRequest} from 'node:https';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
export const receiverHostname='receiver.regpilot-fixture.net';
export async function startDeliveryReceiver(){
 const directory=await mkdtemp(join(tmpdir(),'regpilot-receiver-')),keyPath=join(directory,'key.pem'),certPath=join(directory,'cert.pem');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',keyPath,'-out',certPath,'-days','1','-subj','/CN='+receiverHostname,'-addext','subjectAltName=DNS:'+receiverHostname],{stdio:'ignore'});
 const [key,cert]=await Promise.all([readFile(keyPath),readFile(certPath)]),records=[],accepted=new Set();let secrets=[],nextStatus=200,oversized=false,badChallenge=false,afterRead=null;
 const server=createServer({key,cert},async(request,response)=>{
  const chunks=[];let size=0;for await(const chunk of request){size+=chunk.length;if(size>16384){response.writeHead(413).end();return;}chunks.push(chunk);}const body=Buffer.concat(chunks).toString('utf8');
  const timestamp=request.headers['regpilot-timestamp'],deliveryId=request.headers['regpilot-delivery-id'],signature=request.headers['regpilot-signature'];let valid=false,payload=null;
  try{payload=JSON.parse(body);valid=typeof timestamp==='string'&&typeof deliveryId==='string'&&typeof signature==='string'&&/^v1=[a-f0-9]{64}$/.test(signature)&&Math.abs(Date.now()/1000-Number(timestamp))<=300&&secrets.some(secret=>{const expected=Buffer.from('v1='+createHmac('sha256',Buffer.from(secret.slice(4),'base64url')).update(deliveryId+'.'+timestamp+'.'+body).digest('hex')),actual=Buffer.from(signature);return actual.length===expected.length&&timingSafeEqual(expected,actual);});}catch{}
  records.push({deliveryId,eventId:request.headers['regpilot-event-id'],attemptId:request.headers['regpilot-attempt-id'],valid,payload,duplicate:accepted.has(deliveryId)});
  if(afterRead)await afterRead();
  if(!valid){response.writeHead(401).end();return;}
  const status=nextStatus;nextStatus=200;if(status>=200&&status<300)accepted.add(deliveryId);
  response.writeHead(status,{'Content-Type':'application/json',...(status===429?{'Retry-After':'120'}:{})});
  response.end(oversized?'x'.repeat(4097):JSON.stringify(payload?.type==='endpoint.probe'?{challenge:badChallenge?'0'.repeat(64):payload.data.challenge}:{received:true}));
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();
 const dependencies={resolve:async hostname=>{assert.equal(hostname,receiverHostname);return [{address:'93.184.216.34',family:4}];},request:(options,callback)=>{
  assert.equal(options.hostname,receiverHostname);assert.equal(options.port,443);assert.equal(options.rejectUnauthorized,true);assert.equal(options.servername,receiverHostname);assert.equal(options.agent,false);assert.equal(options.family,4);
  options.lookup(receiverHostname,{family:4},(error,address,family)=>{assert.equal(error,null);assert.equal(address,'93.184.216.34');assert.equal(family,4);});
  return httpsRequest({...options,hostname:'127.0.0.1',port:address.port,lookup:undefined,ca:cert,headers:{...options.headers,host:receiverHostname}},callback);
 }};
 return {url:'https://'+receiverHostname+'/events',dependencies,records,accepted,setSecrets(values){secrets=[...values];},setStatus(value){nextStatus=value;},setOversized(value){oversized=value;},setBadChallenge(value){badChallenge=value;},setAfterRead(fn){afterRead=fn;},async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));secrets=[];await rm(directory,{recursive:true,force:true});}};
}
