import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {crc32} from 'node:zlib';
import {OCR_LIMITS,ocrRawResultSchema,ocrQuestionSourceSchema,reviewOcrText,ocrSourceForSelection} from '../lib/ocr';
import {questionSourceSchema} from '../lib/assurance-operations';
import {inspectOcrFile} from '../lib/server/ocr-file';
import {startOcr,pollOcrWithProvenance} from '../lib/services/azure-ocr';
import {fixtureOcrPng,fixtureOcrJpeg,fixtureScannedPdf,fixtureAzureOcr,OCR_QUESTION,OCR_RECOGNISED} from './helpers/ocr-fixture.mjs';
import {hashValue} from '../lib/regulatory/intelligence';
import {writeQuestionnaireXlsx,inspectQuestionnaireFile} from '../lib/server/questionnaire-workbook.mjs';
const origin='https://fixture.cognitiveservices.azure.com',operation=origin+'/documentintelligence/documentModels/prebuilt-read/analyzeResults/'+randomUUID()+'?api-version=2024-11-30';
function config(){Object.assign(process.env,{REGPILOT_PAID_SERVICES_ENABLED:'true',REGPILOT_PAID_SAFEGUARDS_VERIFIED:'true',REGPILOT_APP_ORIGIN:'https://regpilot.example.invalid',REGPILOT_OCR_ENABLED:'true',AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT:origin,AZURE_DOCUMENT_INTELLIGENCE_KEY:'fictional-ocr-contract-key'});}
async function raw(format='PNG'){config();return (await pollOcrWithProvenance(operation,1,async()=>Response.json(fixtureAzureOcr(format))))!;}
test('bounded OCR intake accepts a real image and a PDF containing only an image, with exact source hash and no invented text',async()=>{
 const jpeg=await inspectOcrFile(fixtureOcrJpeg(),'customer-scan.jpeg');assert.equal(jpeg.format,'JPEG');assert.equal(jpeg.sourceMeta.width,800);assert.equal(jpeg.sourceMeta.height,160);const png=await inspectOcrFile(fixtureOcrPng(),'customer-scan.png'),pdf=await inspectOcrFile(fixtureScannedPdf(),'customer-scan.pdf');assert.equal(png.format,'PNG');assert.equal(png.pageCount,1);assert.deepEqual(png.sourceMeta,{version:'ocr-upload-v1',width:800,height:160});assert.equal(pdf.format,'PDF');assert.equal(pdf.pageCount,1);assert.equal(pdf.sha256.length,64);
 const {extractPdf}=await import('../lib/server/pdf-extraction');assert.equal((await extractPdf(fixtureScannedPdf(),{allowEmpty:true})).characters,0,'the PDF fixture really has no selectable text');
});
test('OCR intake rejects oversized files, CRC-corrupt PNGs, excessive pixels, unsafe filenames and unsupported formats before provider work',async()=>{
 await assert.rejects(()=>inspectOcrFile(Buffer.alloc(OCR_LIMITS.fileBytes+1),'big.png'),(e:any)=>e.status===413);const corrupt=Buffer.from(fixtureOcrPng());corrupt[40]^=1;await assert.rejects(()=>inspectOcrFile(corrupt,'broken.png'));
 const oversized=Buffer.from(fixtureOcrPng());oversized.writeUInt32BE(10001,16);oversized.writeUInt32BE(crc32(oversized.subarray(12,29)),29);await assert.rejects(()=>inspectOcrFile(oversized,'large.png'),/pixels/);
 for(const name of ['../source.png','source.gif','source.bmp','source\n.png'])await assert.rejects(()=>inspectOcrFile(fixtureOcrPng(),name));
});
test('Azure start pins the private byte contract, selected page range and UTF-16 coordinate convention',async()=>{
 config();let called=0;const returned=await startOcr(fixtureOcrPng(),1,async(input,init)=>{called++;const u=new URL(String(input));assert.equal(u.origin,origin);assert.equal(u.searchParams.get('stringIndexType'),'utf16CodeUnit');assert.equal(u.searchParams.get('pages'),'1-1');assert.equal(init?.redirect,'error');assert.deepEqual(Buffer.from(JSON.parse(String(init?.body)).base64Source,'base64'),fixtureOcrPng());return new Response(null,{status:202,headers:{'operation-location':operation}});});assert.equal(returned,operation);assert.equal(called,1);
 process.env.REGPILOT_PAID_SERVICES_ENABLED='false';await assert.rejects(()=>startOcr(fixtureOcrPng(),1,async()=>{called++;throw Error();}));assert.equal(called,1);
});
test('provenance OCR preserves exact machine text, provider spans and page polygons and rejects incomplete or inconsistent recognition',async()=>{
 const result=await raw();assert.equal(result.pages[0].lines[0].text,OCR_RECOGNISED);assert.deepEqual(result.pages[0].lines[0].spans,[{offset:0,length:OCR_RECOGNISED.length}]);assert.equal(result.pages[0].unit,'pixel');
 for(const change of [(d:any)=>delete d.analyzeResult.pages[0].lines[0].polygon,(d:any)=>d.analyzeResult.stringIndexType='textElements',(d:any)=>d.analyzeResult.pages[0].lines[0].spans[0].offset=1,(d:any)=>d.analyzeResult.pages[0].lines[0].polygon[0]=900,(d:any)=>d.analyzeResult.pages[0].pageNumber=2,(d:any)=>d.analyzeResult.pages=[]]){const fixture=fixtureAzureOcr();change(fixture);await assert.rejects(()=>pollOcrWithProvenance(operation,1,async()=>Response.json(fixture)),(e:any)=>['INCOMPLETE_OCR','INVALID_OCR_PROVENANCE'].includes(e.code));}
 assert.equal(await pollOcrWithProvenance(operation,1,async()=>Response.json({status:'running'})),null);
});
test('OCR polling never sends provider credentials to a foreign host, redirect or unpinned model path',async()=>{
 config();let calls=0;for(const u of ['https://evil.invalid'+new URL(operation).pathname,operation+'&redirect=evil',operation.replace('prebuilt-read','other-model'),operation.replace('https:','http:'),operation+'#extra'])await assert.rejects(()=>pollOcrWithProvenance(u,1,async()=>{calls++;throw Error('must not call');}));assert.equal(calls,0);
});
test('reviewing OCR retains raw recognition while exact corrections and source regions are independently representable',async()=>{
 const result=await raw(),before=JSON.stringify(result),reviewed=reviewOcrText(result,[{id:'p1-l1',text:OCR_QUESTION}]);assert.equal(JSON.stringify(result),before);assert.equal(reviewed.pages[0].lines[0].recognizedText,OCR_RECOGNISED);assert.equal(reviewed.pages[0].text,OCR_QUESTION);
 assert.throws(()=>reviewOcrText(result,[]));assert.throws(()=>reviewOcrText(result,[{id:'p1-l2',text:OCR_QUESTION}]));assert.throws(()=>reviewOcrText(result,[{id:'p1-l1',text:OCR_QUESTION},{id:'p1-l1',text:'Other text'}]));
 const source=ocrSourceForSelection({id:randomUUID(),filename:'scan.png',sha256:'a'.repeat(64),format:'PNG',rawHash:hashValue(result)},{id:randomUUID(),resultHash:hashValue(reviewed),result:reviewed},result,{unit:1,start:0,end:OCR_QUESTION.length});assert.equal(source.quote,OCR_QUESTION);assert.equal(source.recognizedQuote,OCR_RECOGNISED);assert.equal(source.regions[0].correctedText,OCR_QUESTION);assert.deepEqual(source.regions[0].polygon,result.pages[0].lines[0].polygon);assert.equal(ocrQuestionSourceSchema.safeParse(source).success,true);
 assert.equal(questionSourceSchema.safeParse({...source,format:'PDF',regions:[]}).success,false,'invalid PDF OCR must not fall back to ordinary PDF provenance');assert.equal(ocrRawResultSchema.safeParse({...result,content:'unrelated'}).success,false);
});
test('OCR source exports preserve exact transcription review, original recognition and region coordinates in workbook provenance',async()=>{
 const result=await raw(),reviewed=reviewOcrText(result,[{id:'p1-l1',text:OCR_QUESTION}]),source=ocrSourceForSelection({id:randomUUID(),filename:'scan.png',sha256:'a'.repeat(64),format:'PNG',rawHash:hashValue(result)},{id:randomUUID(),resultHash:hashValue(reviewed),result:reviewed},result,{unit:1,start:0,end:OCR_QUESTION.length});
 const file=writeQuestionnaireXlsx({title:'Customer scan',questions:[{reference:'S1',question:OCR_QUESTION,answer:'Independently approved response.',source}]}),book=await inspectQuestionnaireFile(file,'response.xlsx'),headers=book.sheets[1].rows[0].cells,values=book.sheets[1].rows[1].cells;
 for(const [label,value] of [['Transcription review ID',source.ocrReviewId],['Recognized line',OCR_RECOGNISED],['Corrected line',OCR_QUESTION],['Source quotation',OCR_QUESTION],['Region polygon',JSON.stringify(source.regions[0].polygon)],['Provider UTF-16 spans',JSON.stringify(source.regions[0].spans)]])assert.equal(values[headers.indexOf(label)],value);
});
test('all new OCR endpoints authenticate before inspecting a multipart body, starting paid work or returning originals',async()=>{
 const [{GET,POST},{GET:get,PATCH},{GET:download},{GET:inspect,POST:importRows}]=await Promise.all([import('../app/api/workspace/questionnaires/ocr/route'),import('../app/api/workspace/questionnaires/ocr/[id]/route'),import('../app/api/workspace/questionnaires/ocr/[id]/original/route'),import('../app/api/workspace/questionnaires/ocr/[id]/import/route')]);
 const org=randomUUID(),id=randomUUID(),params={params:Promise.resolve({id})},request=()=>new Request('https://example.invalid/api?organizationId='+org+'&reviewId='+randomUUID()+'&resultHash='+'a'.repeat(64),{method:'POST',headers:{'content-type':'application/json'},body:'invalid'});process.env.REGPILOT_WORKSPACE_ENABLED='false';
 for(const call of [()=>GET(request()),()=>POST(request()),()=>get(request(),params),()=>PATCH(request(),params),()=>download(request(),params),()=>inspect(request(),params),()=>importRows(request(),params)]){const r=await call();assert.equal(r.status,503);assert.equal(r.headers.get('cache-control'),'no-store');}
 Object.assign(process.env,{REGPILOT_WORKSPACE_ENABLED:'true',DATABASE_URL:'postgresql://unused:unused@127.0.0.1:1/unused',SUPABASE_URL:'https://example.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture',REGPILOT_AI_ALLOWED_EMAILS:'fixture@example.invalid'});for(const call of [()=>POST(request()),()=>get(request(),params),()=>PATCH(request(),params),()=>download(request(),params),()=>importRows(request(),params)])assert.equal((await call()).status,401);
});
