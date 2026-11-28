import assert from 'node:assert/strict';
import test from 'node:test';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {validationReviewPdf} from '../scripts/validation-review-pdf.mjs';

test('printable release evidence carries every requirement, executed test, exact revision and change path',async()=>{
 const revision='4'.repeat(40),parent='3'.repeat(40),at='2026-11-25T00:00:00Z';
 const requirements=Array.from({length:8},(_,n)=>({id:'PH-0'+(n+1),result:'PASS',requirement:'Checked boundary '+n,test:'Executed site software test '+n,file:'tests/site.ts',line:n+1,durationMs:5,testFileSha256:'a'.repeat(64)}));
 const bytes=await validationReviewPdf({revision,parent,startedAt:at,finishedAt:at,runId:'42',attempt:'1',commitSubject:'Prepare site verification',environment:'Synthetic test site',scope:'Site acceptance requires a separate site decision.',requirements,changes:['M\tsrc/calibration.ts']});
 const load=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:false,verbosity:0});
 try{const doc=await load.promise,text=[];assert.ok(doc.numPages>=2);
  for(let i=1;i<=doc.numPages;i++)text.push((await (await doc.getPage(i)).getTextContent()).items.map(item=>item.str).join(' '));
  const full=text.join(' ');for(const expected of [revision,parent,'PH-08','Executed site software test 7','src/calibration.ts','Synthetic test site'])assert.ok(full.includes(expected),expected);
 }finally{await load.destroy();}
});
