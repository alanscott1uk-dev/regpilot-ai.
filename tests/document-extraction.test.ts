import test from "node:test";
import assert from "node:assert/strict";
import {extractDocument} from "../lib/server/document-extraction";
import {extractionBlocked} from "../lib/documents/coverage";
import {fixtureDocx,docxParts,zipFixture,paragraph,wordNamespace} from "./helpers/docx-fixture.mjs";
import {fixturePdf} from "./helpers/pdf-fixture.mjs";
import {groundProgramme} from "../lib/programme/import";
import {groundedAssessment} from "../lib/evidence/assurance";
import {validateAiRequest,validateAndAnnotateAiOutput} from "../lib/ai/contract.mjs";
const id="123e4567-e89b-42d3-a456-426614174000",quote="Fictional staff must complete training before access is granted.";
const read=(bytes:Uint8Array)=>extractDocument(bytes,"example.docx");
test("Word extraction preserves paragraph, table cell and supplementary text coordinates",async()=>{
  const body='<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Training</w:t></w:r></w:p>'+paragraph(quote)+'<w:tbl><w:tr><w:tc>'+paragraph("Person")+'</w:tc><w:tc>'+paragraph("Completed")+'</w:tc></w:tr><w:tr><w:tc>'+paragraph("Fictional Alex")+'</w:tc><w:tc>'+paragraph("2026-11-05")+'</w:tc></w:tr></w:tbl>';
  const d=await read(fixtureDocx(body,[["word/header1.xml",`<w:hdr xmlns:w="${wordNamespace}">${paragraph("Fictional Widget Ltd — internal")}</w:hdr>`],["word/footnotes.xml",`<w:footnotes xmlns:w="${wordNamespace}"><w:footnote w:id="1">${paragraph("Training is renewed annually.")}</w:footnote></w:footnotes>`]]));
  assert.equal(d.unitKind,"block");assert.equal(d.format,"DOCX");assert.equal(d.pages.length,6);assert.equal(d.pages[1].text,quote);assert.match(d.pages[1].label!,/paragraph 2 · Training/);assert.equal(d.pages[3].text,"Fictional Alex\t2026-11-05");assert.equal(d.pages[3].kind,"table-row");assert.match(d.pages[5].label!,/header1/);assert.equal(extractionBlocked(d),false);assert.equal(d.requiresVisualReview,true);
});
test("Word citations are grounded by block and offset, reject invented quotations and preserve legacy PDF coordinates",async()=>{
  const document=await read(fixtureDocx(paragraph(quote))),docs=[{id,filename:"example.docx",document}];
  const candidate={title:"Review staff training records",description:quote,testProcedure:"Inspect a dated training completion record for the selected staff.",theme:"training",citations:[{evidenceId:id,page:1,quote}]};
  const result=groundProgramme({controls:[candidate]},docs);assert.equal(result.controls.length,1);assert.equal(result.controls[0].citations[0].unitKind,"block");assert.match(result.controls[0].citations[0].label!,/paragraph 1/);assert.equal(result.documents[0].unitKind,"block");
  assert.equal(groundProgramme({controls:[{...candidate,citations:[{evidenceId:id,page:2,quote}]}]},docs).rejected,1);
  const assessment=groundedAssessment({checks:[{criterion:"Training is completed before access",sourceQuote:quote,verdict:"SUPPORTED",explanation:"The fictional policy states an intention; implementation requires further records.",citations:[{evidenceId:id,page:1,quote}]}],limitations:[]},quote,docs);
  assert.equal(assessment.passages[0].unitKind,"block");assert.equal(assessment.documents[0].unitKind,"block");
  const pdf=await extractDocument(fixturePdf([[quote]]),"legacy.pdf");assert.equal(pdf.unitKind,"page");assert.equal(pdf.pages[0].page,1);
});
test("unresolved revisions, images, fields and merged cells block acceptance with explicit repair instructions",async()=>{
  for(const feature of ['<w:ins>'+paragraph(quote)+'</w:ins>','<w:p><w:r><w:drawing/></w:r></w:p>','<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r></w:p>','<w:tbl><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>'+paragraph("Test")+'</w:tc></w:tr></w:tbl>']){
    const d=await read(fixtureDocx(paragraph(quote)+feature));assert.equal(extractionBlocked(d),true);assert.ok(d.blockingIssues!.length);
    const r=groundProgramme({controls:[]},[{id,filename:"problem.docx",document:d}]);assert.equal(extractionBlocked(r.documents[0]),true);
  }
});
test("archives reject masquerading files, duplicate paths, traversal, macros and external templates",async()=>{
  const cases=[zipFixture([["fake.txt","not a Word document"]]),zipFixture([...docxParts(),["word/document.xml","duplicate"]]),fixtureDocx(undefined,[["../escape.xml","bad"]]),fixtureDocx(undefined,[["word/vbaProject.bin","macro"]]),fixtureDocx(undefined,[["word/_rels/document.xml.rels",'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r2" Type="https://example.invalid/attachedTemplate" TargetMode="External" Target="https://example.invalid/template"/></Relationships>']])];
  for(const bytes of cases)await assert.rejects(()=>read(bytes),(e:any)=>[415,422].includes(e.status));
});
test("XML entity attacks, deep trees, malformed XML and ZIP expansion are rejected",async()=>{
  const parts=docxParts();parts[2][1]='<!DOCTYPE a [<!ENTITY e SYSTEM "file:///etc/passwd">]>'+parts[2][1];
  const bad=[zipFixture(parts),fixtureDocx('<w:p><w:r><w:instrText>DDEAUTO example command</w:instrText></w:r></w:p>'),fixtureDocx('<w:p>'.repeat(90)+"bad"+'</w:p>'.repeat(90)),fixtureDocx('<w:p>broken'),fixtureDocx(undefined,[["word/oversize.xml","x".repeat(500000)]])];
  for(const bytes of bad)await assert.rejects(()=>read(bytes),(e:any)=>e.status===422);
});
test("ZIP checksums, declared lengths and compressed input caps fail closed",async()=>{
  const bytes=Buffer.from(fixtureDocx());const directory=bytes.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));bytes.writeUInt32LE(123,directory+16);
  await assert.rejects(()=>read(bytes),(e:any)=>e.status===422);
  await assert.rejects(()=>read(new Uint8Array(5000001)),(e:any)=>e.status===413);
});
test("empty Word files and extraction limits are surfaced without inventing OCR results",async()=>{
  const empty=fixtureDocx("");await assert.rejects(()=>read(empty),(e:any)=>e.status===422);
  const d=await extractDocument(empty,"empty.docx",{allowEmpty:true});assert.equal(d.characters,0);assert.equal(extractionBlocked(d),true);assert.match(d.blockingIssues!.join(" "),/OCR is not enabled/);
  const long=await read(fixtureDocx(Array.from({length:510},(_,i)=>paragraph("Fictional independent record "+i+" unique marker "+(i*9197))).join("")));assert.equal(long.totalPages,510);assert.equal(long.pages.length,500);assert.equal(long.truncated,true);
});
test("AI Word inputs have bounded, mutually exclusive files and block-labelled quote grounding",async()=>{
  const file=fixtureDocx(),base={organizationId:id,mode:"document",consent:true,docxBase64:file.toString("base64")};
  assert.equal(validateAiRequest(base).fileFormat,"DOCX");assert.throws(()=>validateAiRequest({...base,evidenceId:id}));assert.throws(()=>validateAiRequest({...base,pdfBase64:"AAAA"}));assert.throws(()=>validateAiRequest({...base,mode:"assistant",question:"What changed?"}));
  const doc=await read(file),result=validateAndAnnotateAiOutput({findings:[{documentQuote:quote,sourceQuote:quote}]},{documentUnitKind:"block",documentPages:doc.pages,sourceText:quote,sourceVerified:true,documentCoverage:{unitKind:"block"}});
  assert.equal(result.findings[0].documentAnchor.coordinateSystem,"normalised-word-block");assert.match(result.findings[0].documentAnchor.label,/paragraph 1/);assert.equal(result.groundingSummary.pdfCoverage,undefined);assert.equal(result.groundingSummary.documentCoverage.unitKind,"block");
});
