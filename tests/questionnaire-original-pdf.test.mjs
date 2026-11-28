import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {fixturePdf,fixtureFillablePdf,readPdfAnswerFields} from './helpers/pdf-fixture.mjs';
import {processOriginalPdf} from '../lib/server/questionnaire-original-pdf.mjs';

test('PDF return binds each approved answer to a distinct printable field on its source page',async()=>{
  const bytes=await fixtureFillablePdf('Q1. Product A?','Q2. Product B?');
  const questions=[{id:'A',page:1,answer:'First product.\nIndependently reviewed.'},{id:'B',page:2,answer:'Second product.'}];
  const mappings=[{questionId:'B',field:'Buyer response 2'},{questionId:'A',field:'Buyer response'}];
  const {result}=await processOriginalPdf(bytes,questions,mappings);
  assert.equal((await readPdfAnswerFields(result))[0].value,questions[0].answer);
  assert.equal((await readPdfAnswerFields(result,2))[0].value,questions[1].answer);
  assert.equal((await readPdfAnswerFields(bytes))[0].value,'');
  await assert.rejects(()=>processOriginalPdf(bytes,questions,[mappings[1],mappings[1]]),/own empty field/);
  await assert.rejects(()=>processOriginalPdf(bytes,questions,[{...mappings[0],field:'Buyer response'},mappings[1]]),/source page/);
});

test('PDF return preserves existing values and refuses flat or undersized answer fields',async()=>{
  const doc=await PDFDocument.load(await fixtureFillablePdf('Q1. Retention?'));
  const existing=doc.getForm().createTextField('Customer reference');
  existing.setText('CUSTOMER-123');
  existing.addToPage(doc.getPages()[0],{x:50,y:60,width:200,height:20});
  const bytes=await doc.save(),q={id:'q',page:1,answer:'Reviewed.'},m=[{questionId:'q',field:'Buyer response'}];
  assert.deepEqual((await processOriginalPdf(bytes,[],null)).fields.map(f=>f.name),['Buyer response']);
  assert.deepEqual((await readPdfAnswerFields((await processOriginalPdf(bytes,[q],m)).result)).find(f=>f.name==='Customer reference'),{name:'Customer reference',value:'CUSTOMER-123'});
  await assert.rejects(()=>processOriginalPdf(fixturePdf([['Flat original']]),[],null),/no fillable form/);
  await assert.rejects(()=>processOriginalPdf(bytes,[{...q,answer:'Line\n'.repeat(100)}],m),/clipped/);
  await assert.rejects(()=>processOriginalPdf(bytes,[{...q,answer:'審査'}],m),/every character/);
});

test('overlapping buyer fields cannot hide a returned answer',async()=>{
  const doc=await PDFDocument.load(await fixtureFillablePdf('Q1. Handling?'));
  doc.getForm().createTextField('Overlay').addToPage(doc.getPages()[0],{x:60,y:450,width:100,height:20});
  const bytes=await doc.save();
  await assert.rejects(()=>processOriginalPdf(bytes,[],null),/No empty, visible, printable/);
});
