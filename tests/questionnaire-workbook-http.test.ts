import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {POST as inspect} from '../app/api/workspace/questionnaires/inspect/route';
import {POST as importFile} from '../app/api/workspace/questionnaires/import/route';
import {POST as exportOriginal} from '../app/api/workspace/questionnaires/[id]/original-export/route';
import {GET as exportFile} from '../app/api/workspace/questionnaires/[id]/export/route';

test('questionnaire file APIs authenticate before parsing uploads or exporting disclosure data',async()=>{
 const organizationId=randomUUID(),id=randomUUID(),params={params:Promise.resolve({id})};
 const request=(suffix='')=>new Request('https://example.invalid/api/workspace/questionnaires?organizationId='+organizationId+suffix,{method:'POST',headers:{'content-type':'multipart/form-data; boundary=invalid'},body:'x'.repeat(200000)});
 process.env.REGPILOT_WORKSPACE_ENABLED='false';
 for(const call of [()=>inspect(request()),()=>importFile(request()),()=>exportFile(request('&format=xlsx'),params),()=>exportFile(request('&format=zip'),params),()=>exportOriginal(request(),params)]){const response=await call();assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');}
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'true',DATABASE_URL:'postgresql://unused:unused@127.0.0.1:1/unused',SUPABASE_URL:'https://example.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture',REGPILOT_AI_ALLOWED_EMAILS:'fixture@example.invalid'});
 for(const call of [()=>inspect(request()),()=>importFile(request()),()=>exportFile(request('&format=xlsx'),params),()=>exportFile(request('&format=zip'),params),()=>exportOriginal(request(),params)]){const response=await call();assert.equal(response.status,401);assert.deepEqual(await response.json(),{error:'Sign in to continue'});assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');}
 for(const call of [inspect,importFile])assert.equal((await call(request('&organizationId='+organizationId))).status,400);
});

test('verified download waits for complete verification and streams a ZIP larger than the buffered hosting limit without changing bytes',async()=>{
 const {verifiedDownloadResponse,VERIFIED_DOWNLOAD_CHUNK_BYTES}=await import('../lib/server/verified-download');
 const {writeResponsePackZip,responsePackHash}=await import('../lib/questionnaire-response-pack');
 const {readZipParts}=await import('./helpers/zip-inspection.mjs');
 const evidence=Buffer.alloc(6*1024*1024+17,0x7a),zip=writeResponsePackZip([{name:'verified-evidence.pdf',bytes:evidence}]);assert.ok(zip.byteLength>4.5*1024*1024);
 let approved!:(value:Uint8Array)=>void,responded=false,verified=false;
 const pending=verifiedDownloadResponse(async()=>{const bytes=await new Promise<Uint8Array>(resolve=>{approved=resolve;});verified=true;return bytes;},{filename:'questionnaire-response-pack.zip',contentType:'application/zip'}).then(response=>{responded=true;return response;});
 await Promise.resolve();assert.equal(responded,false,'no headers or body are returned before the verification promise succeeds');approved(zip);const response=await pending;assert.equal(verified,true);assert.equal(response.status,200);assert.equal(response.headers.get('content-length'),null);assert.match(response.headers.get('cache-control')!,/no-store/);assert.match(response.headers.get('cache-control')!,/no-transform/);assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal(response.headers.get('content-type'),'application/zip');assert.equal(response.headers.get('content-disposition'),'attachment; filename="questionnaire-response-pack.zip"');
 const reader=response.body!.getReader(),chunks:Uint8Array[]=[];while(true){const read=await reader.read();if(read.done)break;assert.ok(read.value.byteLength>0&&read.value.byteLength<=VERIFIED_DOWNLOAD_CHUNK_BYTES);assert.equal(read.value.buffer.byteLength,read.value.byteLength,'chunks do not retain the full archive backing allocation');chunks.push(read.value);}assert.ok(chunks.length>90);
 const received=Buffer.concat(chunks);assert.equal(responsePackHash(received),responsePackHash(zip));assert.deepEqual((await readZipParts(received)).get('verified-evidence.pdf'),evidence);
});

test('verified download releases cancelled streams and aborts before exposing unverified or rejected bytes',async()=>{
 const {verifiedDownloadResponse,VERIFIED_DOWNLOAD_CHUNK_BYTES}=await import('../lib/server/verified-download');
 const bytes=Buffer.alloc(6*1024*1024,0x61),response=await verifiedDownloadResponse(()=>bytes,{filename:'completed-original.xlsx',contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),reader=response.body!.getReader();assert.equal((await reader.read()).value?.byteLength,VERIFIED_DOWNLOAD_CHUNK_BYTES);await reader.cancel('Customer cancelled the download');assert.deepEqual(await reader.read(),{done:true,value:undefined});assert.equal(response.headers.get('content-length'),null);
 const active=new AbortController(),download=await verifiedDownloadResponse(()=>bytes,{filename:'responses.xlsx',contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',signal:active.signal}),activeReader=download.body!.getReader();await activeReader.read();active.abort(new DOMException('Client disconnected','AbortError'));await assert.rejects(()=>activeReader.read(),{name:'AbortError'});
 const cancelled=new AbortController();cancelled.abort();let generated=false;await assert.rejects(()=>verifiedDownloadResponse(()=>{generated=true;return bytes;},{filename:'never.zip',contentType:'application/zip',signal:cancelled.signal}),{name:'AbortError'});assert.equal(generated,false);
 const during=new AbortController();await assert.rejects(()=>verifiedDownloadResponse(async()=>{during.abort();return bytes;},{filename:'never.zip',contentType:'application/zip',signal:during.signal}),{name:'AbortError'});
 await assert.rejects(()=>verifiedDownloadResponse(async()=>{throw Error('Disclosure changed during final verification');},{filename:'never.zip',contentType:'application/zip'}),/Disclosure changed/);
});

test('questionnaire multipart upload bounds remain below the hosting request limit including selection metadata and framing',async()=>{
 const {QUESTIONNAIRE_FILE_LIMITS,readQuestionnaireForm,questionnaireFormFile}=await import('../lib/server/questionnaire-workbook.mjs');
 assert.equal(QUESTIONNAIRE_FILE_LIMITS.fileBytes,3*1024*1024);assert.equal(QUESTIONNAIRE_FILE_LIMITS.requestBytes,4*1024*1024);assert.ok(QUESTIONNAIRE_FILE_LIMITS.requestBytes<4_500_000);
 const form=new FormData();form.set('file',new File([new Uint8Array(QUESTIONNAIRE_FILE_LIMITS.fileBytes)],'questions.docx'));form.set('mapping','x'.repeat(700000));form.set('metadata','x'.repeat(4000));form.set('expectedSha256','a'.repeat(64));
 const request=new Request('https://example.invalid',{method:'POST',body:form}),multipartBytes=(await request.clone().arrayBuffer()).byteLength;assert.ok(multipartBytes<QUESTIONNAIRE_FILE_LIMITS.requestBytes);assert.ok(multipartBytes<4_500_000);const parsed=await readQuestionnaireForm(request);assert.equal(questionnaireFormFile(parsed).size,QUESTIONNAIRE_FILE_LIMITS.fileBytes);assert.equal(String(parsed.get('mapping')).length,700000);
});
