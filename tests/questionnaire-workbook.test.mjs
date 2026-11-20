import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import yauzl from 'yauzl';
import {inspectQuestionnaireFile,mapQuestionnaireWorkbook,writeQuestionnaireXlsx,writeQuestionnaireCsv,readQuestionnaireForm,questionnaireFormFile,QUESTIONNAIRE_FILE_LIMITS,QuestionnaireWorkbookError} from '../lib/server/questionnaire-workbook.mjs';
import {fixtureWorkbook,workbookParts,defaultSheet,inlineCell,sheetRow,sheetNamespace} from './helpers/questionnaire-workbook-fixture.mjs';
import {zipFixture} from './helpers/docx-fixture.mjs';
const inspect=(bytes,filename='customer.xlsx')=>inspectQuestionnaireFile(bytes,filename);
const mapping={sheetId:'sheet1',headerRow:1,questionColumn:2,referenceColumn:1,answerColumn:4,contextColumns:[3]};
const unsupported=error=>error instanceof QuestionnaireWorkbookError&&[413,415,422].includes(error.status);
const unzip=bytes=>new Promise((resolve,reject)=>yauzl.fromBuffer(bytes,{lazyEntries:true},(error,zip)=>{
  if(error)return reject(error);const files=new Map();zip.on('error',reject);zip.on('end',()=>resolve(files));
  zip.on('entry',entry=>zip.openReadStream(entry,(error,stream)=>{if(error)return reject(error);const chunks=[];stream.on('error',reject);stream.on('data',chunk=>chunks.push(chunk));stream.on('end',()=>{files.set(entry.fileName,Buffer.concat(chunks).toString());zip.readEntry();});}));zip.readEntry();
}));

test('file inspection preserves multiple sheets, sparse row coordinates, shared strings and selected source provenance',async()=>{
  const extras=[['xl/sharedStrings.xml',`<sst xmlns="${sheetNamespace}"><si><r><t>What is your </t></r><r><t>incident process?</t></r><rPh sb="0" eb="2"><t>not the cell value</t></rPh></si></sst>`]];
  const bytes=fixtureWorkbook([{name:'Security',xml:defaultSheet()},{name:'Operations',hidden:true,xml:sheetRow(2,[inlineCell('A2','Q-2'),'<c r="B2" t="s"><v>0</v></c>'])}],extras),workbook=await inspect(bytes);
  assert.equal(workbook.format,'XLSX');assert.equal(workbook.sha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(workbook.sheets.length,2);
  assert.equal(workbook.sheets[0].rowCount,4);assert.deepEqual(workbook.sheets[0].rows.map(row=>row.number),[1,4]);assert.equal(workbook.sheets[1].hidden,true);assert.equal(workbook.sheets[1].rows[0].cells[1],'What is your incident process?');
  const rows=mapQuestionnaireWorkbook(workbook,[{sheetId:'sheet2',headerRow:0,questionColumn:2,referenceColumn:1},mapping]);
  assert.deepEqual(rows.map(row=>row.reference),['Q-1','Q-2'],'source worksheet order is stable even when mappings arrive in another order');
  assert.equal(rows[0].instructions,'Instructions: Describe frequency and named owners.');assert.equal(rows[0].suppliedAnswer,'Original supplied response, awaiting review.');
  assert.deepEqual(rows[0].source,{filename:'customer.xlsx',sha256:workbook.sha256,format:'XLSX',sheet:'Security',row:4,questionCell:'B4',referenceCell:'A4',answerCell:'D4',contextCells:['C4']});
  assert.equal(rows[1].source.row,2);assert.ok(workbook.warnings.some(warning=>warning.includes('hidden worksheets')));
});
test('CSV file imports handle quoted commas, multiline values, BOM and exact logical row numbers',async()=>{
  const bytes=Buffer.from('\ufeffReference,Question,Notes\r\n\r\nQ1,"Does it say ""approved"", with an owner?","First line\nSecond line"\r\n');
  const workbook=await inspect(bytes,'received.csv');assert.equal(workbook.sheets[0].rows[1].number,3);
  const rows=mapQuestionnaireWorkbook(workbook,[{sheetId:'csv',headerRow:1,questionColumn:2,referenceColumn:1,contextColumns:[3],instructions:'Apply to the UK service.'}]);
  assert.equal(rows[0].question,'Does it say "approved", with an owner?');assert.equal(rows[0].instructions,'Apply to the UK service.\nNotes: First line\nSecond line');assert.equal(rows[0].source.questionCell,'B3');
  for(const value of ['a,"unclosed','a,"closed"extra','a,\0','Question\n=HYPERLINK("https://example.invalid")','Question\n@SUM(A1)','Question\n+cmd'])await assert.rejects(()=>inspect(Buffer.from(value),'bad.csv'),unsupported);
  await assert.rejects(()=>inspect(Buffer.from([0xff,0xfe,0x51,0]),'utf16.csv'),unsupported);
});
test('worksheet mapping requires bounded, distinct columns and unique references; imported responses remain source input',async()=>{
  const workbook=await inspect(fixtureWorkbook());
  for(const change of [{questionColumn:0},{questionColumn:65},{answerColumn:2},{contextColumns:[3,3]},{contextColumns:[2]},{firstRow:1},{lastRow:20000}])assert.throws(()=>mapQuestionnaireWorkbook(workbook,[{...mapping,...change}]),unsupported);
  assert.throws(()=>mapQuestionnaireWorkbook(workbook,[mapping,mapping]),unsupported);
  const noRef=mapQuestionnaireWorkbook(workbook,[{...mapping,referenceColumn:null}]);assert.equal(noRef[0].reference,'Security!4');assert.equal(noRef[0].source.referenceCell,undefined);
  const duplicate=await inspect(fixtureWorkbook([{name:'Security',xml:defaultSheet()},{name:'Operations',xml:defaultSheet()}]));
  assert.throws(()=>mapQuestionnaireWorkbook(duplicate,[mapping,{...mapping,sheetId:'sheet2'}]),/references must be unique/);
  const many=await inspect(Buffer.from('Question\n'+Array.from({length:101},(_,i)=>'Question number '+i+' to review?').join('\n')),'many.csv');
  assert.throws(()=>mapQuestionnaireWorkbook(many,[{sheetId:'csv',headerRow:1,questionColumn:1}]),error=>error.status===413);
});
test('formulas, external links, macros, active XML, spreadsheet errors and malformed archives fail closed',async()=>{
  const sheets=xml=>[{name:'Security',xml}];
  const bad=[
    fixtureWorkbook(sheets(sheetRow(1,['<c r="A1"><f>HYPERLINK("https://example.invalid")</f><v>1</v></c>']))),
    fixtureWorkbook(sheets(sheetRow(1,['<c r="A1" t="e"><v>#REF!</v></c>']))),
    fixtureWorkbook(undefined,[['xl/vbaProject.bin','macro']]),
    fixtureWorkbook(undefined,[['xl/worksheets/_rels/sheet1.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="link" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" TargetMode="External" Target="https://example.invalid"/></Relationships>']]),
    fixtureWorkbook(undefined,[['../outside.xml','invalid']]),
    zipFixture([...workbookParts(),['xl/workbook.xml','duplicate']]),
    zipFixture([['not-a-workbook.txt','text']]),
    fixtureWorkbook(sheets('<row r="1"><c r="A1" t="inlineStr"><is><t>unclosed')),
  ];
  const entity=workbookParts();entity[4][1]='<!DOCTYPE x [<!ENTITY a SYSTEM "file:///etc/passwd">]>'+entity[4][1];bad.push(zipFixture(entity));
  const names=workbookParts();names[2][1]=names[2][1].replace('</workbook>','<definedNames><definedName name="Unsafe">SUM(A1)</definedName></definedNames></workbook>');bad.push(zipFixture(names));
  for(const bytes of bad)await assert.rejects(()=>inspect(bytes),unsupported);
  await assert.rejects(()=>inspect(fixtureWorkbook(),'customer.xlsm'),error=>error.status===415);
});
test('compressed and expanded quotas, corrupt CRC and cell-address ambiguity are rejected',async()=>{
  await assert.rejects(()=>inspect(new Uint8Array(QUESTIONNAIRE_FILE_LIMITS.fileBytes+1)),error=>error.status===413);
  await assert.rejects(()=>inspect(fixtureWorkbook(undefined,[['xl/too-large.xml','x'.repeat(1000000)]])),error=>error.status===413);
  const damaged=Buffer.from(fixtureWorkbook()),directory=damaged.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));damaged.writeUInt32LE(123,directory+16);await assert.rejects(()=>inspect(damaged),/integrity/);
  for(const xml of [sheetRow(1,[inlineCell('A1','First value'),inlineCell('A1','Duplicate')]),sheetRow(1,[inlineCell('B2','Wrong row')]),sheetRow(1,[inlineCell('BM1','Too many columns')]),'<row r="10001"/>',sheetRow(1,['<c r="A1" t="s"><v>9999</v></c>'])])await assert.rejects(()=>inspect(fixtureWorkbook([{name:'Security',xml}])),unsupported);
  await assert.rejects(()=>inspect(Buffer.from('Question\n'+ 'x'.repeat(6001)),'oversize-cell.csv'),error=>error.status===413);
});
test('completed XLSX is independently readable, preserves ordered approved answers and separates unapproved input provenance',async()=>{
  const original=await inspect(fixtureWorkbook()),rows=mapQuestionnaireWorkbook(original,[mapping]);
  const exported={title:'Customer review',recipient:'Fictional Buyer',scope:'UK service',approvedHash:'a'.repeat(64),approvedAt:'2026-11-20T12:00:00.000Z',questions:rows.map(row=>({...row,answer:'=Literal reviewed text, not an Excel formula.',evidence:[{filename:'approved-policy.pdf',sha256:'b'.repeat(64)}]}))};
  const bytes=writeQuestionnaireXlsx(exported),parts=await unzip(bytes);
  assert.equal(parts.size,7);assert.match(parts.get('xl/worksheets/sheet1.xml'),/t="inlineStr"/);assert.doesNotMatch(parts.get('xl/worksheets/sheet1.xml'),/<f[ >]/);assert.match(parts.get('xl/worksheets/sheet1.xml'),/state="frozen"/);
  assert.doesNotMatch(parts.get('xl/worksheets/sheet1.xml'),/Original supplied response/,'original unapproved answers are not presented in customer responses');
  const readBack=await inspect(bytes,'completed.xlsx');assert.deepEqual(readBack.sheets.map(sheet=>sheet.name),['Responses','Provenance']);
  assert.equal(readBack.sheets[0].rows[1].cells[0],'Q-1');assert.equal(readBack.sheets[0].rows[1].cells[2],exported.questions[0].answer);
  const provenance=readBack.sheets[1].rows[1].cells;assert.equal(provenance[1],'customer.xlsx');assert.equal(provenance[2],original.sha256);assert.equal(provenance[6],'B4');assert.equal(provenance[10],rows[0].suppliedAnswer);assert.match(provenance[11],/approved-policy.pdf.*SHA-256/);assert.equal(provenance[14],exported.approvedHash);
  assert.match(writeQuestionnaireCsv(exported),/"'=Literal reviewed text/);
});
test('multipart bounds apply to streaming bodies without trusted length and reject duplicate files',async()=>{
  const form=new FormData();form.append('file',new File(['Question\nWhat is your access review process?'],'request.csv',{type:'text/csv'}));
  const parsed=await readQuestionnaireForm(new Request('https://example.invalid',{method:'POST',body:form}));assert.equal(questionnaireFormFile(parsed).name,'request.csv');
  parsed.append('file',new File(['more'],'second.csv'));assert.throws(()=>questionnaireFormFile(parsed),/exactly one/);
  await assert.rejects(()=>readQuestionnaireForm(new Request('https://example.invalid',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})),error=>error.status===415);
  let cancelled=false;
  const body=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(QUESTIONNAIRE_FILE_LIMITS.requestBytes+1));},cancel(){cancelled=true;}});
  const request=new Request('https://example.invalid',{method:'POST',headers:{'content-type':'multipart/form-data; boundary=test'},body,duplex:'half'});
  await assert.rejects(()=>readQuestionnaireForm(request),error=>error.status===413);assert.equal(cancelled,true);
});
