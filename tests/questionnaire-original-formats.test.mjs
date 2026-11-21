import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fixtureDocx,paragraph} from './helpers/docx-fixture.mjs';
import {parseDocx,partsOf} from '../lib/server/docx-parser.mjs';
import {writeOriginalDocx} from '../lib/server/questionnaire-original-docx.mjs';
import {inspectQuestionnaireFile,mapQuestionnaireWorkbook,writeOriginalSpreadsheet} from '../lib/server/questionnaire-workbook.mjs';

const wording='How are supplier records checked?';
const answer='An approved answer with & and <text>.';
const filename='buyer.docx';
const table=(question,right='<w:p/>')=>'<w:tbl><w:tr><w:tc>'+paragraph(question)+'</w:tc><w:tc>'+right+'</w:tc></w:tr></w:tbl>';
async function wordQuestions(bytes){
  const document=await parseDocx(bytes);
  return document.pages.filter(p=>p.text.includes(wording)).map(p=>({
    answer,source:{format:'DOCX',sha256:createHash('sha256').update(bytes).digest('hex'),filename,unitKind:'block',
      extractionVersion:document.version,unit:p.page,start:0,end:p.text.length,quote:p.text}
  }));
}

test('Word returns each approved answer at its imported block, retaining other package parts and product labels',async()=>{
  const bytes=fixtureDocx(paragraph('Buyer introduction 📝')+paragraph(wording)+table(wording)+paragraph('Closing terms'),
    [['word/styles.xml','<styles/>']]);
  const questions=await wordQuestions(bytes);
  const multi=['ALPHA','BETA'].map(id=>({...questions[1],product:{code:id,name:id,id},answer:id+'\nSecond line'}));
  const output=await writeOriginalDocx(bytes,filename,[questions[0],...multi]);
  const before=await partsOf(bytes),after=await partsOf(output);
  for(const [key,value] of before)if(key!=='word/document.xml')assert.deepEqual(after.get(key),value);
  const result=await parseDocx(output);
  assert.deepEqual(result.pages.map(p=>p.text),['Buyer introduction 📝',wording,answer,wording+'\t\nALPHA · ALPHA: ALPHA\nSecond line\nBETA · BETA: BETA\nSecond line','Closing terms']);
});

test('Word rejects changed sources, ambiguous ranges, occupied answer cells, protected or signed originals',async()=>{
  const bytes=fixtureDocx(paragraph(wording)),[q]=await wordQuestions(bytes);
  for(const change of [{quote:'Another source'},{start:1},{filename:'other.docx'},{sha256:'0'.repeat(64)}])
    await assert.rejects(()=>writeOriginalDocx(bytes,filename,[{...q,source:{...q.source,...change}}]));
  await assert.rejects(()=>writeOriginalDocx(bytes,filename,[q,q]),/share a Word location/);
  for(const file of [fixtureDocx(table(wording,paragraph('Buyer-owned content'))),
    fixtureDocx(paragraph(wording),[['word/settings.xml','<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:documentProtection/></w:settings>']]),
    fixtureDocx(paragraph(wording),[['_xmlsignatures/sig1.xml','<Signature/>']])]){
    const qs=await wordQuestions(file);
    await assert.rejects(()=>writeOriginalDocx(file,filename,qs));
  }
});

test('CSV preserves original bytes outside chosen answers, including BOM, blank rows and multiline quoted cells',async()=>{
  const text='\uFEFF"Ref",Question,Answer,Notes\r\n\r\n1,"How do you review\naccess?",,"Buyer, supplied"\r\n';
  const input=Buffer.from(text),name='buyer.csv',book=await inspectQuestionnaireFile(input,name);
  const [row]=mapQuestionnaireWorkbook(book,[{sheetId:'csv',headerRow:1,referenceColumn:1,questionColumn:2,answerColumn:3,contextColumns:[4]}]);
  const products=['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
  const value={questions:products.map((id,i)=>({...row,product:{id,code:'P'+i,name:'Product '+i,version:1},answer:i?'Line 1\n"Line 2"':'=approved text'}))};
  const mappings=products.map((productId,i)=>({sheet:'Questionnaire',productId,answerColumn:i===0?3:6}));
  const returned=await writeOriginalSpreadsheet(input,name,value,mappings);
  assert.equal(returned.toString(),text.replace('?",,"Buyer, supplied"','?","\'=approved text","Buyer, supplied",,"Line 1\n""Line 2"""'));
  for(const invalid of [[{...mappings[0],answerColumn:4},mappings[1]],[mappings[0],{...mappings[1],answerColumn:3}]])
    await assert.rejects(()=>writeOriginalSpreadsheet(input,name,value,invalid));
  await assert.rejects(()=>writeOriginalSpreadsheet(Buffer.from(text+'\r\n'),name,value,mappings),/exact original/);
});

test('CSV writes adjacent product answers at a final empty field without adding a newline',async()=>{
  const name='buyer.csv',input=Buffer.from('Question,Answer\rHow do you review access?,');
  const [row]=mapQuestionnaireWorkbook(await inspectQuestionnaireFile(input,name),[{sheetId:'csv',headerRow:1,questionColumn:1,answerColumn:2}]);
  const questions=['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'].map((id,i)=>({...row,product:{id,code:'P',name:'P',version:1},answer:'Product '+i}));
  const mappings=questions.map((q,i)=>({sheet:'Questionnaire',productId:q.product.id,answerColumn:i+2}));
  assert.equal((await writeOriginalSpreadsheet(input,name,{questions},mappings)).toString(),input.toString()+'"Product 0","Product 1"');
});
