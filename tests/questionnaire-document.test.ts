import test from 'node:test';import assert from 'node:assert/strict';
import {inspectQuestionnaireDocument,mapQuestionnaireDocument,documentQuestionCandidates} from '../lib/server/questionnaire-document';
import {questionImportRowSchema} from '../lib/assurance-operations';
import {writeQuestionnaireXlsx,inspectQuestionnaireFile} from '../lib/server/questionnaire-workbook.mjs';
import {fixturePdf} from './helpers/pdf-fixture.mjs';
import {fixtureDocx,paragraph} from './helpers/docx-fixture.mjs';
const selection=(v:any)=>({unit:v.unit,start:v.start,end:v.end,reference:v.reference,question:v.question});
test('PDF question selection retains exact page and character provenance while reviewed wording stays separate',async()=>{
 const input=fixturePdf([['Fictional customer request.','1. How do you review user access?'],['2. Describe your incident escalation process.']]),doc=await inspectQuestionnaireDocument(input,'buyer.pdf');assert.equal(doc.canImport,true);assert.equal(doc.unitKind,'page');assert.equal(doc.candidates.length,2);
 const selected=doc.candidates.map(selection);selected[0].question='Describe how named staff review access to this product.';const rows=mapQuestionnaireDocument(doc,selected);assert.equal(rows[0].question,selected[0].question);assert.equal(rows[0].source.quote,'1. How do you review user access?');assert.equal(rows[1].source.unit,2);assert.equal(doc.units[0].text.slice(rows[0].source.start,rows[0].source.end),rows[0].source.quote);for(const row of rows)assert.ok(questionImportRowSchema.safeParse(row).success);
 const exported=await inspectQuestionnaireFile(writeQuestionnaireXlsx({questions:rows.map(row=>({...row,answer:'Approved scoped response.'}))}),'response.xlsx'),headers=exported.sheets[1].rows[0].cells,cells=exported.sheets[1].rows[1].cells;assert.equal(cells[headers.indexOf('Source quotation')],rows[0].source.quote);assert.equal(cells[headers.indexOf('Source unit kind')],'page');assert.equal(cells[headers.indexOf('Start offset')],String(rows[0].source.start));
});
test('DOCX intake selects stable original blocks, table rows and manual exact passages without pretending to preserve pages',async()=>{
 const input=fixtureDocx(paragraph('Review scope: Fictional UK services only.')+paragraph('How do you approve access changes?')+'<w:tbl><w:tr><w:tc>'+paragraph('Q2')+'</w:tc><w:tc>'+paragraph('Describe supplier evidence reviews.')+'</w:tc></w:tr></w:tbl>'),doc=await inspectQuestionnaireDocument(input,'buyer.docx');assert.equal(doc.canImport,true);assert.equal(doc.unitKind,'block');assert.equal(doc.units.length,3);
 const source=doc.units[0],manual={unit:source.unit,start:0,end:source.text.length,reference:'CUSTOM-1',question:'What is the exact scope of this questionnaire?'};const row=mapQuestionnaireDocument(doc,[manual])[0];assert.equal(row.source.quote,source.text);assert.match(row.source.unitLabel,/paragraph/);assert.equal(row.source.format,'DOCX');assert.ok(doc.candidates.some(c=>/approve access/.test(c.question)));assert.equal(doc.units[2].text,'Q2\tDescribe supplier evidence reviews.');
});
test('document intake rejects forged selections, duplicate source locations, incomplete extraction and unsupported formats',async()=>{
 const doc=await inspectQuestionnaireDocument(fixtureDocx(paragraph('How is evidence independently reviewed?')),'buyer.docx'),candidate=selection(doc.candidates[0]);
 for(const changes of [{unit:499},{end:80000},{start:-1},{end:candidate.start},{quote:'forged'},{question:'short'}])assert.throws(()=>mapQuestionnaireDocument(doc,[{...candidate,...changes}]));assert.throws(()=>mapQuestionnaireDocument(doc,[candidate,{...candidate,reference:'OTHER'}]));assert.throws(()=>mapQuestionnaireDocument({...doc,canImport:false,blockingIssues:['Missing source text']},[candidate]));
 const blank=await inspectQuestionnaireDocument(fixturePdf([[]]),'scan.pdf');assert.equal(blank.canImport,false);assert.ok(blank.blockingIssues.length);await assert.rejects(()=>inspectQuestionnaireDocument(new Uint8Array(3*1024*1024+1),'big.pdf'));await assert.rejects(()=>inspectQuestionnaireDocument(fixtureDocx(),'legacy.doc'));
 const candidates=documentQuestionCandidates([{unit:1,label:'Page 1',text:Array.from({length:510},(_,i)=>'Question '+i+': how are exceptions handled?').join('\n')}],'page');assert.equal(candidates.candidates.length,500);assert.equal(candidates.candidateLimitReached,true);
});
